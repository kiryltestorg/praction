
const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const https = require('https');
const url = require('url');
const path = require('path')
const { PutObjectCommand, S3Client, ListObjectsCommand } = require('@aws-sdk/client-s3')
const { Octokit, App } = require("octokit");

var bucketName = core.getInput("bucketName")
let client = new S3Client();
let octokit = new Octokit({ auth: core.getInput("token") });
var repo_list_string = core.getInput("repo")
var repo_list = repo_list_string.split(",");

var depPath = core.getInput("depPath")


const dir = fs.opendirSync(depPath)
let dirent

function getMainRef(){
  var ref = octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner: 'kiryltestorg',
    repo: 'mainRepo',
    ref: 'heads/main'
  })
  return ref 
}
function createRef(hash){
   octokit.request('POST /repos/{owner}/{repo}/git/refs', {
    owner: 'kiryltestorg',
    repo: 'mainRepo',
    ref: 'refs/heads/Pr1',
    sha: hash
  })
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
async function createPr(){
  var ref = await getMainRef()
  createRef(ref.data.object.sha)
   console.log(ref.data.object.sha)

   
   await exec.exec('git', ['checkout', 'Pr1'], options);
  
console.log(myError)
console.log(myOutput)
}
createPr()


async function updateConfig(){
while ((dirent = dir.readSync()) !== null) {
  console.log(dirent.name)
  var config = JSON.parse(fs.readFileSync(path.join(depPath,dirent.name)), 'utf8');
  // opening dependency json file 
  console.log(config)
  config['SHA256']="2243"
  await exec.exec('git', ['commit', '-m', 'updated config'], options);
}}
updateConfig()
