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
var repo = core.getInput("repo")

var putParams = {
    Bucket: bucketName,
    Prefix: "Dependencies/" + repo + "/",

 
};




async function updateDep( FILE_NAME, tag_name){
 console.log(FILE_NAME)
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

function compareVersions(v1, v2){
  let v1_split = v1.split(".")
  let v2_split = v2.split(".")
  if(v1_split.length == v2_split.length){
    for(let i = 0 ; i<v1_split.length; i++){
      if(v1_split[i] > v2_split[i]){
        return 1
    }
      if(v1_split[i]<v2_split[i]){
        return -1
    }
  }
      return 0
  }
  else{
    return 0
}
}

async function syncDependencies(){
  var s3_dep_list = await list()
  var gh_latest_release = await getLatest()
  
  console.log(s3_dep_list) 
  var g_tag = gh_latest_release.data.tag_name.replace("v", "")
  if(!s3_dep_list){
    updateDep(repo + "-" + g_tag + ".tar.gz", g_tag)
    return
  }
  
  var s3_latest = s3_dep_list[0]
  var s3_latest_tag = s3_latest.Key.substring(s3_latest.Key.indexOf('-') + 1 , s3_latest.Key.indexOf(".tar"))
  console.log(s3_latest_tag)
  console.log(g_tag)


  if(compareVersions(g_tag,s3_latest_tag)){
    updateDep(repo + "-" + g_tag + ".tar.gz", g_tag)
  }

}


syncDependencies()
