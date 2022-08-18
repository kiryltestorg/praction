const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  S3Client,
  ListObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { Octokit, App } = require("octokit");
const exec = require("@actions/exec");

const bucketName = core.getInput("bucketName");
const client = new S3Client();
const octokit = new Octokit({ auth: core.getInput("token") });
const depPath = core.getInput("depPath");
const repo = core.getInput("repo");
const owner = core.getInput("owner");
const main_branch = core.getInput("main_branch");

// opens folder where dependency configs are stored
const dir = fs.opendirSync(depPath);

async function getMainRef() {
  // create ref of the main branch
  try {
    let ref = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
      owner: owner,
      repo: repo,
      ref: "heads/" + main_branch,
    });
  } catch (err) {
    console.log(err);
    throw err;
  }
  return ref;
}

async function createRef(hash, branchName) {
  // creating a new branch with name: branchName
  // based on hash taken from the branch we want the new one to be based on
  try {
    console.log("creating ref");
    const res = await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
      owner: owner,
      repo: repo,
      ref: "refs/heads/" + branchName,
      sha: hash,
    });
  } catch (err) {
    console.log(err);
    throw err;
  }
  return res;
}

async function createBranch(branchName) {
  try {
    // get ref of branch we want the new branch to be based on
    let ref = await getMainRef();

    const hash = ref.data.object.sha;
    
    // pass in the hash
    const res = await createRef(hash, branchName);
  } catch (err) {
    console.log(err);
    throw err;
  }
}

async function listDependenciesS3(path) {
  const params = {
    Bucket: bucketName,
    Prefix: path + "/",
  };

  // gets all objects in the bucket specified by path
  const data = await client.send(new ListObjectsCommand(params));
  if (data.length < 0) {
    return data;
  }

  // gets all the file names that end with the file extension .gz and sorts them by LastModified Desc
  // result is an array with the most recent versions of the tar files coming first
  const files = data.Contents?.filter((file) => {
    return file.Key.includes(".gz");
  }).sort((file1, file2) => file2.LastModified - file1.LastModified);

  return files;
}

async function generateHash(key) {
  const params = {
    Bucket: bucketName,
    Key: key,
  };
  try {
    // Create a helper function to convert a ReadableStream to a string.
    const streamToString = (stream) =>
      new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });

    // Get the object} from the Amazon S3 bucket. It is returned as a ReadableStream.
    const data = await client.send(new GetObjectCommand(params));

    // Convert the ReadableStream to a string.
    const bodyContents = await streamToString(data.Body);

    // creating hash object
    const hash = crypto.createHash("sha512");

    // passing the data to be hashed
    hash_data = hash.update(bodyContents, "utf-8");

    // Creating the hash in the required format
    gen_hash = hash_data.digest("hex");
    return gen_hash;
  } catch (err) {
    console.log("Error", err);
    throw err;
  }
}

async function getLastModified(key) {
  const params = {
    Bucket: bucketName,
    Key: key,
  };
  // getting last modified time of an object in s3 bucket
  const data = await client.send(new HeadObjectCommand(params));
  return data.LastModified;
}

async function existsPR() {
  const res = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
    owner: owner,
    repo: repo,
  });
  // checking if a pull request with "Automated Config Update" as the title exists
  return (
    res.data.filter((e) => e.title === "Automated Config Update").length > 0
  );
}

async function deleteBranch(branchName) {
  try {
    return await octokit.request(
      "DELETE /repos/{owner}/{repo}/git/refs/{ref}",
      {
        owner: owner,
        repo: repo,
        ref: "heads/" + branchName,
      }
    );
  } catch (err) {
    console.log(err);
    throw err;
  }
}

async function getBranches() {
  try {
    const res = await octokit.request("GET /repos/{owner}/{repo}/branches", {
      owner: owner,
      repo: repo,
    });
    return res.data.filter((e) => e.name.includes("AutomatedConfigUpdate"));
  } catch (err) {
    console.log(err);
    throw err;
  }
}

async function cleanUpBranches() {
  const branchList = await getBranches();
  branchList.forEach((branch) => {
    deleteBranch(branch.name);
  });
}

async function updateConfig() {
  try {
    const exists_PR = await existsPR();

    // if a pull request exists, exit early
    if (exists_PR) {
      console.log("A Pull Request Already Exists");

      return;
    }
    console.log("Cleaning Up Branches");
    await cleanUpBranches();

    // generate new branch name with current time
    const branchName = "AutomatedConfigUpdate_" + new Date().getTime().toString();

    // create new branch
    await createBranch(branchName);

    // fetch changes
    await exec.exec("git", ["fetch"]);

    // checkout created branch
    console.log("checking out Code");
    await exec.exec("git", ["checkout", branchName]);

    let dirent;

    // reading all the files in folder where dependency configs are stored
    while ((dirent = dir.readSync()) !== null) {
      console.log(dirent.name);
      const current_repo = dirent.name.replace(".json", "");

      // opening dependency json file
      let config = JSON.parse(
        fs.readFileSync(path.join(depPath, dirent.name)),
        "utf8"
      );
      if (config["freeze"]) {
        console.log("Version Freeze Enabled Skipping Updates");
        continue;
      }

      // getting list of tar files stored on s3 sorted by version descending
      const s3_dep_list = await listDependenciesS3(
        "Dependencies/" + current_repo
      );

      // if there are no tar files stored on s3, no pull request is needed
      if (!s3_dep_list) {
        console.log("No Dependencies on S3 storage");
        continue;
      }

      // getting the newest version of the tar file
      const s3_latest = s3_dep_list[0];

      // getting the last modified time of the newest version of the tar file
      const lastModified = await getLastModified(s3_latest.Key);

      // if config has been updated before
      if (config["last_updated"] != "") {
        // get time last updated
        const last_updated = new Date(config["last_updated"]);

        // if the newest tar file was uploaded after the last time the config file was updated then config file needs to be updated
        if (lastModified > last_updated) {
          // change last updated time to current time
          config["last_updated"] = new Date().toUTCString();
        } else {
          console.log("config already up to date");
          continue;
        }
      } else {
        // config has never been updated, so last updated time must be now
        config["last_updated"] = new Date().toUTCString();
      }
      // generate hash of latest tar file stored on s3
      const hash = await generateHash(s3_latest.Key);

      console.log("hash:" + hash);
      console.log(s3_latest.Key);
      config["SHA512"] = hash;
      const version =
        "v" +
        s3_latest.Key.replace(
          "Dependencies/" + current_repo + "/" + current_repo + "-",
          ""
        ).replace(".tar.gz", "");
      config["version"] = version;

      // writing changes to file
      await fs.writeFile(
        path.join(depPath, dirent.name),
        JSON.stringify(config),
        function writeJSON(err) {
          if (err) return console.log(err);
        }
      );
    } // add changes to git
    await exec.exec("git", ["add", "."]);

    // commit changes
    await exec.exec("git", ["commit", "-m", "Automated Config Update"]);

    // push to remote origin
    await exec.exec("git", ["push"]);

    // create pull request from newly created branch to the main branch
    await octokit.request("POST /repos/{owner}/{repo}/pulls", {
      owner: owner,
      repo: repo,
      title: "Automated Config Update",
      body: "Approve Changes",
      head: branchName,
      base: main_branch,
    });
  } catch (err) {
    // Commiting and Pushing Changes failed
    // Abort Creating Pull request
    // Delete newly created branch

    await deleteBranch(branchName);
  }
}
updateConfig();
