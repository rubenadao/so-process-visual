#!/usr/bin/env node
/**
 * Headless C/C++ runner using JSCPP
 * 
 * Usage:
 *   node cli/run.js [file.c]           - Run a C file
 *   node cli/run.js --code "int main() { return 0; }"  - Run inline code
 *   node cli/run.js --debug [file.c]   - Run with step-by-step debugging
 *   node cli/run.js --help             - Show help
 * 
 * Examples:
 *   node cli/run.js src/lib/fork_test.cpp
 *   node cli/run.js --debug src/lib/fork_test.cpp
 */

import JSCPP from 'JSCPP';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Track fork events for visualization
let forkCount = 0;
const processes = new Map(); // pid -> process info

// Custom fork implementation for CLI
const customIncludes = {
  "unistd.h": {
    load: function(rt) {
      rt.regFunc(function(rt, _this) {
        forkCount++;
        const childPid = forkCount;
        
        console.log(`${colors.yellow}[FORK]${colors.reset} fork() called - creating child process (pid=${childPid})`);
        console.log(`${colors.dim}  Parent will receive: ${childPid}${colors.reset}`);
        console.log(`${colors.dim}  Child would receive: 0${colors.reset}`);
        
        // In CLI mode, we simulate parent behavior (return child PID)
        // The actual tree visualization happens in the web UI
        return rt.val(rt.intTypeLiteral, childPid);
      }, "global", "fork", [], rt.intTypeLiteral);
      
      // Register _exit() - terminates process immediately
      rt.regFunc(function(rt, _this, statusCode) {
        const exitCode = statusCode ? statusCode.v : 0;
        console.log(`${colors.yellow}[EXIT]${colors.reset} _exit(${exitCode}) called`);
        throw {type: 'return', value: rt.val(rt.intTypeLiteral, exitCode)};
      }, "global", "_exit", [rt.intTypeLiteral], rt.voidTypeLiteral);
    }
  }
};

function printHelp() {
  console.log(`
${colors.bright}JSCPP CLI Runner${colors.reset}
Run C/C++ code from the terminal using JSCPP interpreter.

${colors.cyan}Usage:${colors.reset}
  node cli/run.js [options] [file]

${colors.cyan}Options:${colors.reset}
  --help, -h      Show this help message
  --debug, -d     Run in step-by-step debug mode
  --code, -c      Run inline code (next arg is the code)
  --input, -i     Provide input for the program (next arg is input)

${colors.cyan}Examples:${colors.reset}
  node cli/run.js program.c
  node cli/run.js --debug program.c
  node cli/run.js --code "int main() { printf(\\"Hello\\\\n\\"); return 0; }"
  node cli/run.js --input "42" program.c

${colors.cyan}Debug Mode Commands:${colors.reset}
  n, next         Step to next line
  c, continue     Run to completion
  v, vars         Show current variables
  l, line         Show current line
  q, quit         Exit debugger
`);
}

function getCodeFromFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`${colors.red}Error: File not found: ${resolvedPath}${colors.reset}`);
    process.exit(1);
  }
  return fs.readFileSync(resolvedPath, 'utf-8');
}

function runCode(code, input = '') {
  console.log(`${colors.cyan}═══════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}Running C/C++ Program${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════${colors.reset}\n`);
  
  let output = '';
  
  const config = {
    stdio: {
      drain: () => {
        const x = input;
        input = '';
        return x;
      },
      write: (s) => {
        output += s;
        process.stdout.write(s);
      }
    },
    includes: customIncludes
  };
  
  try {
    const exitCode = JSCPP.run(code, input, config);
    console.log(`\n${colors.cyan}═══════════════════════════════════════${colors.reset}`);
    console.log(`${colors.green}Program exited with code: ${exitCode}${colors.reset}`);
    if (forkCount > 0) {
      console.log(`${colors.yellow}Total fork() calls: ${forkCount}${colors.reset}`);
      console.log(`${colors.dim}(In web UI, this would create ${Math.pow(2, forkCount)} processes)${colors.reset}`);
    }
  } catch (error) {
    console.error(`\n${colors.red}Error: ${error.message}${colors.reset}`);
    if (error.stack) {
      console.error(`${colors.dim}${error.stack}${colors.reset}`);
    }
    process.exit(1);
  }
}

async function runDebugMode(code, input = '') {
  console.log(`${colors.cyan}═══════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}Debug Mode${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════${colors.reset}`);
  console.log(`${colors.dim}Commands: (n)ext, (c)ontinue, (v)ars, (l)ine, (q)uit${colors.reset}\n`);
  
  const lines = code.split('\n');
  
  const config = {
    stdio: {
      drain: () => {
        const x = input;
        input = '';
        return x;
      },
      write: (s) => {
        process.stdout.write(`${colors.green}[OUTPUT]${colors.reset} ${s}`);
      }
    },
    includes: customIncludes,
    debug: true
  };
  
  let debugger_;
  try {
    debugger_ = JSCPP.run(code, input, config);
  } catch (error) {
    console.error(`${colors.red}Compilation Error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  function showCurrentLine() {
    try {
      const node = debugger_.nextNode();
      if (node) {
        const lineNum = node.sLine;
        const lineContent = lines[lineNum - 1] || '';
        console.log(`${colors.yellow}Line ${lineNum}:${colors.reset} ${lineContent.trim()}`);
      }
    } catch (e) {
      console.log(`${colors.dim}(Unable to get current line)${colors.reset}`);
    }
  }
  
  function showVariables() {
    try {
      const vars = debugger_.variable();
      if (vars && vars.length > 0) {
        console.log(`${colors.magenta}Variables:${colors.reset}`);
        vars.forEach(v => {
          console.log(`  ${colors.cyan}${v.name}${colors.reset} (${v.type}) = ${colors.bright}${v.value}${colors.reset}`);
        });
      } else {
        console.log(`${colors.dim}No variables in scope${colors.reset}`);
      }
    } catch (e) {
      console.log(`${colors.dim}(Unable to get variables)${colors.reset}`);
    }
  }
  
  function step() {
    try {
      const done = debugger_.continue();
      if (done !== false) {
        const exitCode = typeof done === 'object' ? done.v : done;
        console.log(`\n${colors.green}Program finished with exit code: ${exitCode}${colors.reset}`);
        rl.close();
        process.exit(0);
      }
      showCurrentLine();
    } catch (e) {
      console.error(`${colors.red}Runtime Error: ${e.message}${colors.reset}`);
      rl.close();
      process.exit(1);
    }
  }
  
  // Initial step to start execution
  step();
  
  const prompt = () => {
    rl.question(`${colors.blue}debug>${colors.reset} `, (answer) => {
      const cmd = answer.trim().toLowerCase();
      
      switch (cmd) {
        case 'n':
        case 'next':
        case '':
          step();
          break;
        case 'c':
        case 'continue':
          console.log(`${colors.dim}Running to completion...${colors.reset}\n`);
          let done = false;
          while (!done) {
            try {
              const result = debugger_.continue();
              if (result !== false) {
                done = true;
                const exitCode = typeof result === 'object' ? result.v : result;
                console.log(`\n${colors.green}Program finished with exit code: ${exitCode}${colors.reset}`);
              }
            } catch (e) {
              console.error(`${colors.red}Runtime Error: ${e.message}${colors.reset}`);
              done = true;
            }
          }
          rl.close();
          process.exit(0);
          break;
        case 'v':
        case 'vars':
          showVariables();
          break;
        case 'l':
        case 'line':
          showCurrentLine();
          break;
        case 'q':
        case 'quit':
          console.log(`${colors.dim}Exiting debugger...${colors.reset}`);
          rl.close();
          process.exit(0);
          break;
        default:
          console.log(`${colors.dim}Unknown command. Use: (n)ext, (c)ontinue, (v)ars, (l)ine, (q)uit${colors.reset}`);
      }
      
      prompt();
    });
  };
  
  prompt();
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

let code = '';
let input = '';
let debugMode = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--debug' || arg === '-d') {
    debugMode = true;
  } else if (arg === '--code' || arg === '-c') {
    code = args[++i];
  } else if (arg === '--input' || arg === '-i') {
    input = args[++i];
  } else if (!arg.startsWith('-')) {
    // Assume it's a file path
    code = getCodeFromFile(arg);
  }
}

if (!code) {
  console.error(`${colors.red}Error: No code provided. Use --help for usage.${colors.reset}`);
  process.exit(1);
}

// Run the code
if (debugMode) {
  runDebugMode(code, input);
} else {
  runCode(code, input);
}
