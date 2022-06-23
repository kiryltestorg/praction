const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const https = require('https');
const url = require('url');
const {  PutObjectCommand, S3Client ,ListObjectsCommand} = require('@aws-sdk/client-s3')
const  { Octokit, App } = require("octokit");

var bucketName = core.getInput("bucketName")
let client = new S3Client();
let octokit = new Octokit({ auth: core.getInput("token")});

var putParams = {
    Bucket: bucketName,
    Prefix: "Dependencies/" + repo + "/",

 
};

var repo = core.getInput("repo")
console.log(repo)


async function updateDep( FILE_NAME, tag_name){
var TAR_URL = 'https://api.github.com/repos/kiryltestorg/' + repo + '/tarball/' + tag_name;

var path = "Dependencies/" + repo + "/" + FILE_NAME


var options = {
  host: 'api.github.com',
  path: TAR_URL,
  method: 'GET',
  headers: {'user-agent': 'node.js'}
};

https.get(options, (res) => {
 
  const writeStream = fs.createWriteStream(FILE_NAME);
 
  res.pipe(writeStream);
 
  writeStream.on("finish", function() {
    writeStream.close();
    console.log("The download is Completed");
    var fileStream = fs.createReadStream(FILE_NAME);
    var putParams = {
    Bucket: bucketName,
    Key: path,
    Body: fileStream
};
const data =  client.send(new PutObjectCommand(putParams));
    
  });
});

}
async function list(){
const data =  await client.send(new ListObjectsCommand(putParams));    
if(data.length<0){
    return data
}
var files = data.Contents?.filter((file)=>{return file.Key.indexOf('.gz')>0}).sort((file1,file2)=> -1* file1.Key.localeCompare(file2.Key))
return files
}
async function getLatest(){
var latest = await octokit.request('GET /repos/{owner}/{repo}/releases/latest', {
  owner: 'kiryltestorg',
  repo: repo
}

)
return latest
}

async function compare_versions(){
  var deps = await list()
  var curr = await getLatest()
  console.log(deps)
  console.log(curr)
if(!deps){
    var g_tag = curr.data.tag_name
  var g_tag_int  = g_tag.replace(/\D/g,'');
  g_tag_int = parseInt(g_tag_int)

    updateDep(repo + g_tag.substring(g_tag.indexOf('v') + 1, g_tag.length) + ".tar.gz", g_tag)
  }
  var c = deps[0]
  console.log(c.Key)
  var current_tag = c.Key.substring(c.Key.indexOf('-') + 1 , c.Key.indexOf(".tar"))
  console.log(current_tag)
  console.log(curr.data.tag_name)
  var g_tag = curr.data.tag_name
  var g_tag_int  = g_tag.replace(/\D/g,'');
  var current_tag_int = current_tag.replace(/\D/g,'');

  g_tag_int = parseInt(g_tag_int)
  current_tag_int = parseInt(current_tag_int)


  if( g_tag_int > current_tag_int){
    console.log("here")
    updateDep(repo + "-" + g_tag.substring(g_tag.indexOf('v') + 1, g_tag.length) + ".tar.gz", g_tag)
  }

}


compare_versions()
