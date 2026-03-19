declare global {
  interface Window {
    JSCPP: {
      run: (code: string, input: string, config: JSCPPConfig) => any;
    };
  }
}

interface JSCPPConfig {
  stdio: {
    drain: () => string | null;
    write: (s: string) => void;
  };
  debug?: boolean;
  includes?: any; // Add this to support custom includes
  nodeId?: string; // Add a nodeId property to identify which node is running this code
  isChildProcess?: boolean; // Add isChildProcess property to determine if this is a child process
}

// Import custom functions
import customIncludes from '../custom_functions';

interface JSCPPDebugger {
  run: (code: string, input: string, config: JSCPPConfig) => Promise<any>;
  continue: () => Promise<boolean | { v: number }>;
  getSource: () => Promise<string>;
  variable: () => Promise<Array<{ name: string; value: string; type: string; }>>;
  nextNode: () => Promise<{ sLine: number; sColumn: number; }>;
}

export class CPPDebugger {
  private _debugger: any = null;
  private input: string = '';
  private output: string = '';
  private lastOutputLength: number = 0;
  private onOutputChange: (output: string) => void;
  private onLineChange: (line: number) => void;
  public lineChangeHandler: ((line: number) => void) | null = null;
  private static jscppPromise: Promise<void> | null = null;
  private nodeId: string; // Add nodeId property to the debugger instance
  private isChildProcess: boolean;
  private sourceCode: string = ''; // Store the source code

  constructor(
    onOutputChange: (output: string) => void,
    onLineChange: (line: number) => void,
    nodeId: string = '',
    isChildProcess: boolean = false
  ) {
    this.onOutputChange = onOutputChange;
    this.onLineChange = onLineChange;
    this.lastOutputLength = 0;
    this.nodeId = nodeId; // Store the node ID
    this.isChildProcess = isChildProcess;
  }

  // Getter to expose the debugger instance
  get debugger() {
    return this._debugger;
  }

  setInput(input: string) {
    this.input = input;
  }

  private loadJSCPP(): Promise<void> {
    if (window.JSCPP) {
      return Promise.resolve();
    }

    if (CPPDebugger.jscppPromise) {
      return CPPDebugger.jscppPromise;
    }

    CPPDebugger.jscppPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${window.location.origin}/JSCPP.es5.min.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load JSCPP'));
      document.head.appendChild(script);
    });

    return CPPDebugger.jscppPromise;
  }

  async startDebug(code: string): Promise<void> {
    try {
      this.sourceCode = code; // Store the source code
      await this.loadJSCPP();
      
      // Reset internal state
      this.output = '';
      this.lastOutputLength = 0;
      
      const config: JSCPPConfig = {
        stdio: {
          drain: () => {
            const x = this.input;
            this.input = '';
            return x;
          },
          write: (s: string) => {
            // Add the new output to our buffer
            this.output += s;
            
            // Only send the new part to the output handler
            // This allows incremental updates rather than sending the entire output each time
            this.onOutputChange(s);
            this.lastOutputLength = this.output.length;
          }
        },
        // Add custom includes to the configuration
        includes: customIncludes,
        debug: true,
        nodeId: this.nodeId, // Pass the node ID to the runtime
        isChildProcess: this.isChildProcess // Pass whether this is a child process
      };

      this._debugger = window.JSCPP.run(code, this.input, config);
      this.stepNext();
    } catch (error) {
      console.error('Debug start error:', error);
      const errorMessage = `\nError: ${error}`;
      this.output += errorMessage;
      this.onOutputChange(errorMessage);
    }
  }

  // Synchronous version of startDebug for cloning purposes
  startDebugSync(code: string): void {
    try {
      // Store the source code
      this.sourceCode = code;
      
      // Check if JSCPP is loaded, if not this will fail
      if (!window.JSCPP) {
        throw new Error('JSCPP not loaded, cannot start debugging synchronously');
      }
      
      // Reset internal state
      this.output = '';
      this.lastOutputLength = 0;
      
      const config: JSCPPConfig = {
        stdio: {
          drain: () => {
            const x = this.input;
            this.input = '';
            return x;
          },
          write: (s: string) => {
            // Add the new output to our buffer
            this.output += s;
            
            // Only send the new part to the output handler
            this.onOutputChange(s);
            this.lastOutputLength = this.output.length;
          }
        },
        includes: customIncludes,
        debug: true,
        nodeId: this.nodeId,
        isChildProcess: this.isChildProcess // Explicitly mark as child process
      };

      this._debugger = window.JSCPP.run(code, this.input, config);
    } catch (error) {
      console.error('Sync debug start error:', error);
      const errorMessage = `\nError: ${error}`;
      this.output += errorMessage;
      this.onOutputChange(errorMessage);
    }
  }

  stepNext(): void {
    if (!this._debugger) {
      throw new Error('Debugger not initialized');
    }

    try {
      const done = this._debugger.continue();
      if (done !== false) {
        const exitCode = typeof done === 'object' ? done.v : 0;
        const exitMessage = `\nProgram exited with code ${exitCode}`;
        this.output += exitMessage;
        
        // Send only the new output (the exit message)
        this.onOutputChange(exitMessage);
        this.stop();
      } else {
        // Get the next line to be executed
        const nextNode = this._debugger.nextNode();
        if (nextNode) {
          const currentLine = nextNode.sLine - 1; // Convert to 0-based line number
          
          // Only trigger line change events if the line has actually changed
          // This helps avoid unnecessary rerenders
          this.onLineChange(currentLine);
          
          // Also call the lineChangeHandler if provided
          if (this.lineChangeHandler) {
            this.lineChangeHandler(currentLine);
          }
          
          // Check if there's new output
          const currentOutput = this.output;
          if (currentOutput.length > this.lastOutputLength) {
            // Get only the new part of the output
            const newOutput = currentOutput.substring(this.lastOutputLength);
            if (newOutput) {
              this.onOutputChange(newOutput);
            }
            this.lastOutputLength = currentOutput.length;
          }
          
          // Get and log all variables
          this.logProgramState();
        }
      }
    } catch (error) {
      console.error('Debug step error:', error);
      const errorMessage = `\nError: ${error}`;
      this.output += errorMessage;
      this.onOutputChange(errorMessage);
      this.stop();
    }
  }

  private logProgramState(): void {
    if (!this._debugger) return;
    
    try {
      // Get all variables from the debugger (using synchronous call)
      const variables = this._debugger.variable();
      
      // Print variables to console
      if (variables && variables.length > 0) {
        console.log('Program state after instruction:');
        console.table(variables.map((v: any) => ({
          name: v.name,
          value: v.value,
          type: v.type
        })));
      }
    } catch (error) {
      console.error('Failed to get program state:', error);
    }
  }

  stop(): void {
    this._debugger = null;
    this.onLineChange(-1); // Clear line highlight
    this.lastOutputLength = 0;
  }

  isDebugging(): boolean {
    return this._debugger !== null;
  }

  // Get the source code
  getSourceCode(): string {
    return this.sourceCode;
  }

  // Get the current line being executed
  getCurrentLine(): number {
    if (!this._debugger) return -1;
    
    try {
      const nextNode = this._debugger.nextNode();
      return nextNode ? nextNode.sLine - 1 : -1;
    } catch (error) {
      console.error('Error getting current line:', error);
      return -1;
    }
  }

  // Set current line (used for synchronizing forked processes)
  setCurrentLine(line: number): void {
    if (!this._debugger) return;
    
    try {
      // If we have a lineChangeHandler, call it directly
      if (this.lineChangeHandler) {
        this.lineChangeHandler(line);
      }
      
      // Also call the main line change callback
      this.onLineChange(line);
    } catch (error) {
      console.error('Error setting current line:', error);
    }
  }

  // Additional helper method to safely get variables with fallbacks
  getVariables(): any[] {
    // Safety check for debugger existence
    if (!this.debugger) {
      return [];
    }
    
    // Get the variables from the debugger
    try {
      // Try using the variable method on the debugger
      if (typeof this.debugger.variable === 'function') {
        const variables = this.debugger.variable();
        
        // Filter out invalid variables and ensure required properties exist
        const validVariables = variables.filter((v: any) => {
          return v && typeof v === 'object' && v.name && v.type && 'value' in v;
        });
        
        // Only add the pid variable for child nodes
        // We can detect child nodes by checking if the nodeId contains "node-" but isn't "root"
        const isChildNode = this.nodeId && this.nodeId !== 'root' && this.nodeId.indexOf('node-') === 0;
        const hasPidVar = validVariables.some((v: any) => v.name === 'pid');
        
        if (!hasPidVar && isChildNode) {
          // Only add PID to child nodes, not the root node
          validVariables.push({
            name: 'pid',
            type: 'int',
            value: '1',
          });
        }
        
        return validVariables;
      } else {
        return [];
      }
    } catch (error) {
      return [];
    }
  }

  clearOutput(): void {
    this.output = '';
    this.lastOutputLength = 0;
    this.onOutputChange('');
  }

  // Enable forking for this debugger (call after child catch-up is complete)
  enableForking(): void {
    this.isChildProcess = false;
    // Also update the config if the debugger is already running
    if (this._debugger && this._debugger.rt && this._debugger.rt.config) {
      this._debugger.rt.config.isChildProcess = false;
      console.log(`Enabled forking for node ${this.nodeId}`);
    }
  }

  // Method to set variables in the debugger
  setVariables(variables: Array<{ name: string; type: string; value: any }>): boolean {
    if (!this.debugger || !this.debugger.scope || !this.debugger.scope[0] || !this.debugger.scope[0].variables) {
      return false;
    }
    
    try {
      // Copy each variable to the scope
      variables.forEach(v => {
        if (v.name && v.type) {
          this.setVariable(v.name, v.value);
        }
      });
      return true;
    } catch (error) {
      console.error('Error setting variables:', error);
      return false;
    }
  }

  // Method to set a specific variable value
  setVariable(name: string, value: string): void {
    if (!this._debugger) return;
    
    try {
      // Get all variables
      const variables = this.getVariables();
      
      // Find the variable to update
      const variableToUpdate = variables.find((v: any) => v.name === name);
      
      if (variableToUpdate) {
        // If we have direct access to scope, update it there
        if (this._debugger.scope && this._debugger.scope[0] && this._debugger.scope[0].variables) {
          // Create appropriate value object based on variable type
          if (typeof this._debugger.val === 'function') {
            let typeLiteral;
            
            switch (variableToUpdate.type) {
              case 'int':
                typeLiteral = this._debugger.intTypeLiteral;
                break;
              case 'float':
              case 'double':
                typeLiteral = this._debugger.doubleTypeLiteral;
                break;
              case 'char':
                typeLiteral = this._debugger.charTypeLiteral;
                break;
              default:
                typeLiteral = this._debugger.intTypeLiteral; // Default to int
                break;
            }
            
            // Set variable in scope
            this._debugger.scope[0].variables[name] = this._debugger.val(typeLiteral, value);
          } else {
            // Fallback: try direct assignment
            this._debugger.scope[0].variables[name] = value;
          }
        }
      }
    } catch (error) {
      console.error(`Error setting variable ${name}:`, error);
    }
  }

  // Method to clone the internal state to another debugger instance
  cloneInternalState(targetDebugger: CPPDebugger): void {
    if (!this._debugger || !targetDebugger) return;
    
    try {
      // First ensure target debugger has the code loaded
      const code = this.getSourceCode();
      if (!code) {
        console.error('Cannot clone debugger state: no source code available');
        return;
      }
      
      // Start the target debugger with the same code
      targetDebugger.startDebugSync(code);
      
      // Get the current line
      const currentLine = this.getCurrentLine();
      
      // Get all variables to copy
      const variables = this.getVariables();
      
      // Step the target debugger to reach the current line
      // This is necessary to ensure the execution context is properly set up
      let targetLine = targetDebugger.getCurrentLine();
      
      // Step until we reach the current line
      while (targetDebugger.isDebugging() && targetLine < currentLine) {
        targetDebugger.stepNext();
        targetLine = targetDebugger.getCurrentLine();
      }
      
      // Now apply all variables to the target debugger
      if (variables && variables.length > 0) {
        // Transform pid for child process
        const transformedVars = variables.map((v: any) => {
          if (v.name === 'pid' && targetDebugger.isChildProcess) {
            return { ...v, value: '0' }; // Child sees pid=0
          }
          return { ...v };
        });
        
        // Set all variables
        targetDebugger.setVariables(transformedVars);
      }
      
      // Ensure the current line is set in the target
      targetDebugger.setCurrentLine(currentLine);
      
    } catch (error) {
      console.error('Error cloning debugger state:', error);
    }
  }
} 