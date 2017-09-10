/* 
    SLACK REMINDER
    created by: Daniel Russell (github.com/danielrussellla)
    date: 9/6/2017
*/

// call this file by typing something like: `user=bob pr=https://github.com/myorg/myorgrepo/pull/12345 node remind.js`
'use-strict'
let USER = process.env.user || process.env.name || process.env.username || process.env.NAME || process.env.USERNAME;
let PR = process.env.pr || process.env.PR || process.env.link || process.env.LINK;
let FORCE_REMIND = process.env.f || process.env.force || false;
let REMINDER_FREQUENCY = 3600000; // 1 hour
let GITHUB_FREQUENCCY = 20000;
let NUM_REMINDERS_SENT = 0;

const fs = require('fs');
const error = require('./util/error');
const github = require('./util/github');
const slack = require('./util/slack');
const notificationScheduler = require('./util/notificationScheduler');


if (!USER || !PR) {
    error.log({
        error: `missing environment variables`,
        reason: `"user" or "pr" environment variables not defined.`,
        solution: `Try running the command like: user=bob pr=https://github.com/myorg/myorgrepo/pull/12345 node remind.js`
    })
    return;
} else {
    USER = USER.split(',')
}

notificationScheduler.init(PR);

let github_url_regex = /(https:\/\/github.com)/;
let pull_request_regex = /(\/pull)/
if(!PR.match(github_url_regex) || !PR.match(pull_request_regex)) {
    error.log({
        error: `invalid github pull request url provided`,
        reason: `your pr url does not include https://github.com or the /pull route`,
        solution: `Try running the command like: user=bob pr=https://github.com/organization/repo/pull/12345 node remind.js`
    })
    return;
}

let isValidPRNumber = (url) => {
    let sections = url.split('/');
    let isValid = false;
    sections.forEach((section) => {
        if (parseInt(section) !== NaN) {
            if(section.length === 5) {
                isValid = true;
            }
        }
    });
    return isValid;
}

if (!isValidPRNumber(PR)) {
    error.log({
        error: 'ERROR: invalid PR url',
        reason: 'your pr url does not have a valid pr number',
        solution: 'please enter a PR with a valid number. ex: https://github.com/organization/repo/12345'
    });
    return;
}


let remind = (user) => {
    slack.sendMessage({
        name: user.name,
        to: user.id,
        pr: PR
    });
}

let scheduleReminders = () => {
    let schedules = {};

    slack.getUserList().then((response) => {
        let users = response.members;
        users.forEach( (user, i) => {
            USER.some((name, j) => {
                if (name.toLowerCase() === user.name.toLowerCase() ||
                name.toLowerCase() === user.profile.real_name.toLowerCase()) {
                    
                    remind(user); // initial reminder
                    notificationScheduler.send({ name, type: 'reminderSent', pr: PR })
                    NUM_REMINDERS_SENT++;
                    
                    schedules[user.id] = setInterval(() => {
                        remind(user);
                        notificationScheduler.send({ name, type: 'reminderSent', pr: PR })
                        NUM_REMINDERS_SENT++;

                        if (NUM_REMINDERS_SENT == 5) {
                            clearInterval(schedules[user.id]); // stop reminders after 5
                            delete schedules[user.id];
                        }
                    }, REMINDER_FREQUENCY) // repeat reminder
                    
                    USER.splice(j, 1);
                    return true;
                }
            })
            
            if (i === users.length - 1 && USER.length) {
                error.log({
                    error: `Invalid slack username(s)`,
                    reason: `Messages not sent to ${USER.join(', ')}`,
                    solution: 'Please enter a valid slack user'
                });
            }
        });
    })    
}

scheduleReminders();


let checkGithubForUpdates = () => {
    let comments = 0;
    let approved = false;
    
    let logUpdate = (githubData) => {
        console.log('current PR status from github: \n', {
            pr: PR,
            comments: githubData.data.comments + githubData.data.review_comments,
            approved: githubData.data.mergeable_state !== 'blocked'
        })
        if (githubData.data.mergeable_state !== 'blocked' && approved == false) {
            notificationScheduler.send({ type: 'readyToMerge', pr: PR })
            approved = true;
        }
    }
    
    github.getPullRequest(PR)
        .then((githubData) => {
            comments = githubData.data.comments + githubData.data.review_comments;
            logUpdate(githubData);
            
        })
        .catch((err) => {
            console.log(err);
        })


    setInterval(() => {
        github.getPullRequest(PR)
            .then((githubData) => {
                logUpdate(githubData);
                
                if (githubData.data.review_comments + githubData.data.comments > comments) {
                    comments = githubData.data.comments + githubData.data.review_comments;
                    notificationScheduler.send({ type: 'commentAdded', pr: PR })
                } else if (githubData.data.review_comments + githubData.data.comments < comments) {
                    comments = githubData.data.comments + githubData.data.review_comments;
                    notificationScheduler.send({ type: 'commentRemoved', pr: PR })
                }
            })
            .catch((err) => {
                console.log(err);
            })
    }, GITHUB_FREQUENCCY)
}

checkGithubForUpdates();
