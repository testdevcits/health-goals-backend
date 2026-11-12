'use strict';

const mail = require('../src/services/mail.service');

mail.verifySmtp()
  .then(({ host, port, secure }) => {
    console.log(`SMTP connection verified: ${host}:${port} (secure=${secure})`);
    console.log('No email was sent.');
  })
  .catch(error => {
    console.error(`SMTP verification failed: ${error.message}`);
    process.exitCode = 1;
  });
