export interface VariableInfo {
  name: string;
  value: any;
  type: string;
  nodeId?: string;
  nodeName?: string;
  nodePath?: string;
}

// Re-export everything from types/index.ts for components
export * from './types/index'; 