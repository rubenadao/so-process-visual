// Adapter to use CInterpreter with the existing App.tsx interface
// This provides the same API as CPPDebugger but uses the new Ohm-based interpreter

import { CInterpreter, InterpreterState, ForkEvent, Variable, WaitCallback } from './interpreter';

export class CInterpDebugger {
  private interpreter: CInterpreter | null = null;
  private code: string = '';
  private _isDebugging: boolean = false;
  public nodeId: string;
  public isChildProcess: boolean;
  
  // Callbacks
  private onOutputChange: (output: string) => void;
  private pendingForkHandler: ((event: ForkEvent) => void) | null = null;
  private pendingWaitHandler: WaitCallback | null = null;

  constructor(
    onOutputChange: (output: string) => void,
    nodeId: string = 'root',
    isChildProcess: boolean = false
  ) {
    this.onOutputChange = onOutputChange;
    this.nodeId = nodeId;
    this.isChildProcess = isChildProcess;
  }

  // Match CPPDebugger API
  setInput(_input: string): void {
    // Not used in current implementation
  }

  async startDebug(code: string): Promise<void> {
    this.startDebugSync(code);
  }

  startDebugSync(code: string): void {
    try {
      this.code = code;
      this.interpreter = new CInterpreter(code, this.nodeId);
      this._isDebugging = true;

      // Set up output callback
      this.interpreter.setOnOutput((text) => {
        this.onOutputChange(text);
      });

      // Apply any pending fork handler
      if (this.pendingForkHandler) {
        console.log(`Applying pending fork handler for node ${this.nodeId}`);
        this.interpreter.setOnFork(this.pendingForkHandler);
      } else {
        console.log(`No pending fork handler for node ${this.nodeId}`);
      }
      
      // Apply any pending wait handler
      if (this.pendingWaitHandler) {
        console.log(`Applying pending wait handler for node ${this.nodeId}`);
        this.interpreter.setOnWait(this.pendingWaitHandler);
      }
      // Line state is read externally via getCurrentLine() - no callbacks needed
    } catch (error) {
      console.error('Error starting debug:', error);
      this.onOutputChange(`Error: ${error}\n`);
    }
  }

  stepNext(): void {
    if (!this.interpreter) return;

    try {
      const hasMore = this.interpreter.step();
      if (!hasMore) {
        this._isDebugging = false;
      }
    } catch (error) {
      console.error('Error during step:', error);
      this.onOutputChange(`\nError: ${error}`);
      this._isDebugging = false;
    }
  }

  stop(): void {
    this._isDebugging = false;
    this.interpreter = null;
  }

  isDebugging(): boolean {
    return this._isDebugging;
  }

  getCurrentLine(): number {
    if (!this.interpreter) return -1;
    // Return 0-based line number
    return this.interpreter.getCurrentLine() - 1;
  }

  getCurrentRange(): { startLine: number; startCol: number; endLine: number; endCol: number } | null {
    if (!this.interpreter) return null;
    return this.interpreter.getCurrentRange();
  }

  getVariables(): Array<{ name: string; value: string; type: string }> {
    if (!this.interpreter) return [];
    return this.interpreter.getVariables().map(v => ({
      name: v.name,
      value: String(v.value),
      type: v.type
    }));
  }

  setVariable(name: string, value: string): void {
    if (!this.interpreter) return;
    const numValue = parseInt(value, 10);
    this.interpreter.setVariable(name, isNaN(numValue) ? value : numValue);
  }

  setVariables(vars: Array<{ name: string; value: string; type: string }>): void {
    for (const v of vars) {
      this.setVariable(v.name, v.value);
    }
  }

  // Fork event handling
  setOnFork(handler: (event: ForkEvent) => void): void {
    // Store the handler for later if interpreter doesn't exist yet
    this.pendingForkHandler = handler;
    if (this.interpreter) {
      this.interpreter.setOnFork(handler);
    }
  }

  // Wait callback - called when a process executes wait()
  setOnWait(handler: WaitCallback): void {
    // Store the handler for later if interpreter doesn't exist yet
    this.pendingWaitHandler = handler;
    if (this.interpreter) {
      this.interpreter.setOnWait(handler);
    }
  }

  // Enable forking for child processes (after catch-up)
  enableForking(): void {
    // Not needed in new implementation - child processes can always fork
    // since we properly advance PC past the fork
  }

  // Create a child debugger from cloned state
  static fromState(
    code: string,
    state: InterpreterState,
    nodeId: string,
    onOutputChange: (output: string) => void
  ): CInterpDebugger {
    const debugger_ = new CInterpDebugger(onOutputChange, nodeId, true);
    debugger_.code = code;
    debugger_.interpreter = CInterpreter.fromState(code, state, nodeId);
    debugger_._isDebugging = true;

    // Set up output callback only - line state is read via getCurrentLine()
    debugger_.interpreter.setOnOutput((text) => {
      debugger_.onOutputChange(text);
    });

    return debugger_;
  }

  // Expose interpreter for direct access if needed
  get interp(): CInterpreter | null {
    return this.interpreter;
  }

  // Get raw state for cloning
  getState(): InterpreterState | null {
    return this.interpreter?.getState() || null;
  }
}
