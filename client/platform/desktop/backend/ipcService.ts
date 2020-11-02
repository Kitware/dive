import { spawn } from 'child_process';
// eslint-disable-next-line import/no-extraneous-dependencies
import { ipcMain } from 'electron';
// eslint-disable-next-line import/no-extraneous-dependencies
import xml from 'xml2json';

import server from './server';

async function runPipeline() {
  const job = spawn('ls', ['-lh', '/usr']);
  job.stdout.on('data', (chunk) => {
    console.log(chunk.toString('utf-8'));
  });
  job.on('close', (code) =>{
    console.log(`Exited with code ${code}`);
  });
}

// Based on https://github.com/chrisallenlane/node-nvidia-smi
async function nvidiaSmi(): Promise<any> {
  // XML parser options
  const options = {
    explicitArray : false,
    trim          : true,
  };
  return new Promise((resolve, reject) => {
    const smi = spawn('nvidia-smi', ['-q', '-x']);
    let result = Buffer.from('');
    smi.stdout.on('data', (chunk) => {
      result = Buffer.concat([result, chunk]);
    });
    smi.on('close', (code) => {
      if (code === 0) {
        const jsonStr = xml.toJson(result, options);
        resolve(JSON.parse(jsonStr));
      } else {
        reject(result);
      }
    });
  });
}

export default function register() {
  ipcMain
    .on('info', (event) => {
      // eslint-disable-next-line no-param-reassign
      event.returnValue = server.address();
    })
    .on('smi', async (event) => {
      event.returnValue = await nvidiaSmi();
    });
}
