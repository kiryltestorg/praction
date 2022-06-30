
const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const https = require('https');
const url = require('url');
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
while ((dirent = dir.readSync()) !== null) {
  console.log(dirent.name)
}
dir.closeSync()
