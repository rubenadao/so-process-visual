export interface TreeNode {
  id: string;
  name?: string;
  description?: string;
  hasImage?: boolean;
  imageUrl?: string;
  hasIcon?: boolean;
  customHtml?: string;
  children?: TreeNode[];
  code?: string;
  isDebugging?: boolean;
  currentLine?: number;
  debuggerInstance?: any;
}

export interface VariableInfo {
  name: string;
  value: any;
  type: string;
  nodeId?: string;
  nodeName?: string;
  nodePath?: string;
} 