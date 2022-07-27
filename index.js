
const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path')
const { S3Client, ListObjectsCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const { Octokit, App } = require("octokit");
const exec = require('@actions/exec');


var bucketName = core.getInput("bucketName")
let client = new S3Client();
let octokit = new Octokit({ auth: core.getInput("token") });
var depPath = core.getInput("depPath")
var repo = core.getInput("repo")
var owner = core.getInput("owner")
var main_branch = core.getInput("main_branch")

const dir = fs.opendirSync(depPath)
//opens folder where dependency configs are stored
let dirent

function getMainRef() {
  var ref = octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner: owner,
    repo: repo,
    ref: 'heads/' + main_branch
  })
  //create ref of the main branch 
  return ref
}


let myOutput = '';
let myError = '';

const options = {
  listeners: {
    stdout: (data) => {
      myOutput += data.toString();
    },
    stderr: (data) => {
      myError += data.toString();
    }
  }
};

function createRef(hash, branchName) {
  //creating a new branch with name: branchName
  //based on hash taken from the branch we want the new one to be based on 
  console.log("creating ref")
  return new Promise(function (resolve, reject) {
    var res = octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner: owner,
      repo: repo,
      ref: 'refs/heads/' + branchName,
      sha: hash
    })


    resolve(res)
  })
}
async function createBranch(branchName) {
  try {
    var ref = await getMainRef()
    //get ref of branch we want the new branch to be based on 
    var hash = ref.data.object.sha
    //pass in the hash 
    var res = await createRef(hash, branchName)
  }
  catch (err) {
    console.log(err)
  }

}

async function ListDepS3(path) {
  var params = {
    Bucket: bucketName,
    Prefix: path + "/",
  };

  const data = await client.send(new ListObjectsCommand(params));
  if (data.length < 0) {
    return data
  }
  //gets all objects in the bucket specified by path 
  var files = data.Contents?.filter((file) => { return file.Key.indexOf('.gz') > 0 }).sort((file1,file2)=>(-1*(file1.LastModified-file2.LastModified)))
  //gets all the file names that end with the file extension .gz and sorts them by LastModified Desc 
  //result is an array with the most recent versions of the tar files coming first 
  return files
}
async function generateHash(key) {

  var params = {
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
    var crypto = require('crypto');
    //creating hash object 
    var hash = crypto.createHash('sha512');
    //passing the data to be hashed
    hash_data = hash.update(bodyContents, 'utf-8');
    //Creating the hash in the required format
    gen_hash = hash_data.digest('hex');
    return gen_hash
  } catch (err) {
    console.log("Error", err);
  }

};
async function getLastModified(key) {
  var params = {
    Bucket: bucketName,
    Key: key,
  };
  //getting last modified time of an object in s3 bucket 
  const data = await client.send(new HeadObjectCommand(params));
  return data.LastModified
}
async function existsPR() {
  var res = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
    owner: owner,
    repo: repo
  })
  //checking if a pull request with "Updated Config" as the title exists 
  return (res.data.filter(e => e.title === 'Updated Config').length > 0)

}
async function deleteBranch(branchName){
  return await octokit.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', {
    owner: owner,
    repo: repo,
    ref: 'heads/' + branchName
  })
}
async function getBranches(){
  var res = await octokit.request('GET /repos/{owner}/{repo}/branches', {
    owner: owner,
    repo: repo
  })
  return (res.data.filter(e=>e.name.includes("UpdateConfig")))
}
async function CleanUpBranches(){
  var branchList = await getBranches()
  branchList.forEach(branch =>{
     deleteBranch(branch.name)
  });
}
async function updateConfig() {
  var exists_PR = await existsPR()
  if (exists_PR) {
    console.log("A Pull Request Already Exists")
    //if a pull request exists, exit early 
    return
  }
  console.log("Cleaning Up Branches")
  await CleanUpBranches()
  var branchName = "UpdateConfig_" + new Date().getTime().toString();
  //generate new branch name with current time 
  await createBranch(branchName)
  //create new branch 
  await exec.exec('git', ['fetch'], options);
  //fetch changes 
  console.log("checking out Code")
  await exec.exec('git', ['checkout', branchName], options);
  //checkout created branch 
  while ((dirent = dir.readSync()) !== null) {
    // reading all the files in folder where dependency configs are stored
    console.log(dirent.name)
    var config = JSON.parse(fs.readFileSync(path.join(depPath, dirent.name)), 'utf8');
    if(config["freeze"]){
      console.log("Version Freeze Enabled Skipping Updates")
      continue
    }
    // opening dependency json file 
    var s3_dep_list = await ListDepS3("Dependencies/" + dirent.name.replace(".json", ""))
    //getting list of tar files stored on s3 sorted by version descending 
    if (!s3_dep_list) {
      //if there are no tar files stored on s3, no pull request is needed 
      continue
    }
    var s3_latest = s3_dep_list[0]
    //getting the newest version of the tar file 

    var LastModified = await getLastModified(s3_latest.Key)
    //getting the last modified time of the newest version of the tar file 

    if (config["last_updated"] != "") {
      //if config has been updated before
      var last_updated = new Date(config["last_updated"])
      //get time last updated
      
      if (LastModified > last_updated) {
        //if the newest tar file was uploaded after the last time the config file was updated then config file needs to be updated
        config["last_updated"] = new Date().toUTCString();
        //change last updated time to current time 
      }
      else {
        console.log("config already up to date")
        continue
      }


    }
    else {
      config["last_updated"] = new Date().toUTCString();
      //config has never been updated, so last updated time must be now 
    }


    var hash = await generateHash(s3_latest.Key)
    //generate hash of latest tar file stored on s3 
    console.log("hash:" + hash)
    console.log(s3_latest.Key)
    config['SHA512'] = hash
    var repo = dirent.name.replace(".json", "")
    var version = "v" + s3_latest.Key.replace("Dependencies/" + repo + "/" + repo  + "-","").replace(".tar.gz","")
    config["version"] = version
    
    await fs.writeFile(path.join(depPath, dirent.name), JSON.stringify(config), function writeJSON(err) {
      if (err) return console.log(err);
    });
    //writing changes to file 


  }
  try {
    await exec.exec('git', ['add', '.'], options);
    //add changes to git 
    await exec.exec('git', ['commit', '-m', 'updated config'], options);
    //commit changes 
    await exec.exec('git', ['push'], options);
    //push to remote origin 
    await octokit.request('POST /repos/{owner}/{repo}/pulls', {
      owner: owner,
      repo: repo,
      title: 'Updated Config',
      body: 'Approve Changes',
      head: branchName,
      base: main_branch
    })
    //create pull request from newly created branch to the main branch 
  }
  catch (err) {
    //Commiting and Pushing Changes failed
    //Abort Creating Pull request
    //Delete newly created branch 
    await deleteBranch(branchName)
  }
}
updateConfig()
