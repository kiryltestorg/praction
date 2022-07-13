
const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path')
const {  S3Client, ListObjectsCommand } = require('@aws-sdk/client-s3')
const { Octokit, App } = require("octokit");

var bucketName = core.getInput("bucketName")
let client = new S3Client();
let octokit = new Octokit({ auth: core.getInput("token") });
var repo_list_string = core.getInput("repo")
var repo_list = repo_list_string.split(",");
var token = core.getInput("token")
var depPath = core.getInput("depPath")


const dir = fs.opendirSync(depPath)
let dirent

function getMainRef() {
  var ref = octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner: 'kiryltestorg',
    repo: 'mainRepo',
    ref: 'heads/main'
  })
  return ref
}
const exec = require('@actions/exec');

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

function createRef(hash) {
  console.log("creating ref")
  return new Promise(function (resolve, reject) {
    var res = octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner: 'kiryltestorg',
      repo: 'mainRepo',
      ref: 'refs/heads/Pr1',
      sha: hash
    })

    resolve(res)
  })
}
async function createPr() {
  var ref = await getMainRef()

  console.log(ref.data.object.sha)
  var hash = ref.data.object.sha
  var res = await createRef(hash)




  console.log(myError)
  console.log(myOutput)
}

async function list(path) {
  var params = {
    Bucket: bucketName,
    Prefix: path + "/",
  };

  const data = await client.send(new ListObjectsCommand(params));
  if (data.length < 0) {
    return data
  }
  //gets all objects in the bucket folder specified by path 
  var files = data.Contents?.filter((file) => { return file.Key.indexOf('.gz') > 0 }).sort((file1, file2) => -1 * file1.Key.localeCompare(file2.Key))
  //gets all the file names that end with the file extension .gz and sorts them desc alphabetically
  return files
}
async function generateHash(key,path){
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
     // return data; // For unit tests.
    // Convert the ReadableStream to a string.
    const bodyContents = await streamToString(data.Body);
    var crypto = require('crypto');
    //creating hash object 
    var hash = crypto.createHash('sha512');
    //passing the data to be hashed
    hash_data = hash.update(bodyContents, 'utf-8');
    //Creating the hash in the required format
    gen_hash= hash_data.digest('hex');
    //Printing the output on the console
    console.log("hash : " + gen_hash);

    console.log(bodyContents);
      //return bodyContents;
  } catch (err) {
    console.log("Error", err);
  }
  return gen_hash
};
async function updateConfig() {
  await createPr()
  await exec.exec('git', ['fetch'], options);
  console.log("checking out Code")
  await exec.exec('git', ['checkout', 'Pr1'], options);
  while ((dirent = dir.readSync()) !== null) {
    console.log(dirent.name)
    var config = JSON.parse(fs.readFileSync(path.join(depPath, dirent.name)), 'utf8');
    // opening dependency json file 
    var s3_dep_list = await list("Dependencies/" +  dirent.name.replace(".json",""))
    if(!s3_dep_list){
      continue
    }
    var s3_latest = s3_dep_list[0]
    var hash = await generateHash("Dependencies/" +  dirent.name.replace(".json","")+ "/" + s3_latest)
    console.log(config)
    config['SHA256'] = hash
    await fs.writeFile(path.join(depPath, dirent.name), JSON.stringify(config), function writeJSON(err) {
      if (err) return console.log(err);
      console.log(JSON.stringify(config));
    });


  }
  await exec.exec('git', ['add', '.'], options);
  await exec.exec('git', ['commit', '-m', 'updated config'], options);
  await exec.exec('git', ['push'], options);
  await octokit.request('POST /repos/{owner}/{repo}/pulls', {
    owner: 'kiryltestorg',
    repo: 'mainRepo',
    title: 'Updated Config',
    body: 'Approve Changes',
    head: 'Pr1',
    base: 'main'
  })
}
updateConfig()
