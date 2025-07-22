#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const MAX_LOG_SIZE = 1024 * 1024; // 1MB
const LOG_FILE = path.join(__dirname, '../k6-output.log');
const ROTATE_LOG_FILE = path.join(__dirname, '../k6-output.old.log');

// Rotate logs if needed
function rotateLogs() {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > MAX_LOG_SIZE) {
      // Rotate the log
      if (fs.existsSync(ROTATE_LOG_FILE)) {
        fs.unlinkSync(ROTATE_LOG_FILE);
      }
      fs.renameSync(LOG_FILE, ROTATE_LOG_FILE);
      console.log('Rotated log file due to size limit');
    }
  } catch (err) {
    // File doesn't exist yet, that's fine
  }
}

// Create/open log file
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

console.log(`Running k6 load test...`);
console.log(`Logs will be written to: ${LOG_FILE}`);

// Start k6 with arguments
const k6Process = spawn('k6', ['run', 'scripts/loadTest.ts'], {
  cwd: path.dirname(__dirname),
  env: process.env
});

// Handle stdout
k6Process.stdout.on('data', (data) => {
  const output = data.toString();
  
  // Write to file
  logStream.write(output);
  
  // Write summary info to console (filter out verbose logs)
  const lines = output.split('\n');
  lines.forEach(line => {
    if (line.includes('level=error') || 
        line.includes('Test summary:') || 
        line.includes('thresholds') ||
        line.includes('✓') || 
        line.includes('✗') ||
        line.includes('scenarios:')) {
      process.stdout.write(line + '\n');
    }
  });
  
  // Check if we need to rotate
  rotateLogs();
});

// Handle stderr
k6Process.stderr.on('data', (data) => {
  const output = data.toString();
  logStream.write(`[STDERR] ${output}`);
  process.stderr.write(output);
});

// Handle exit
k6Process.on('close', (code) => {
  logStream.end();
  console.log(`\nk6 process exited with code ${code}`);
  console.log(`Full logs available at: ${LOG_FILE}`);
  process.exit(code);
});

// Handle errors
k6Process.on('error', (err) => {
  console.error('Failed to start k6:', err);
  logStream.end();
  process.exit(1);
});