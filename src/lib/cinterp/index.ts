// C Interpreter module - main export
export { CInterpreter, parse } from './interpreter';
export type { Variable, InterpreterState, ForkEvent, SourceRange, WaitCallback, WaitResult } from './interpreter';

// Adapter for App.tsx integration
export { CInterpDebugger } from './adapter';
