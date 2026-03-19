export interface SourceRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface TreeNode {
  id: string;
  name: string;
  description?: string;
  hasImage?: boolean;
  imageUrl?: string;
  hasIcon?: boolean;
  customHtml?: string;
  code?: string;
  children?: TreeNode[];
  debuggerInstance?: any;
  currentLine?: number;
  currentRange?: SourceRange | null;
  isDebugging?: boolean;
  parentNodeId?: string;  // Track parent node for wait()
  isWaiting?: boolean;    // Process is blocked on wait()
  isTerminated?: boolean; // Process has finished execution
}

export interface TreeVisualizerProps {
  data: TreeNode;
  width?: number;
  height?: number;
  nodePadding?: number;
  boxWidth?: number;
  boxHeight?: number;
  nodeSeparation?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  nodeRadius?: number;
  nodeColor?: string;
  linkColor?: string;
  verticallyConstrained?: boolean;
  isCompactMode?: boolean;
  isHorizontalLayout?: boolean;
  spacingMultiplier?: number;
  editorTheme?: string;
  showInlineVariables?: boolean;
  onNodeClick?: (node: TreeNode) => void;
  onStepNode?: (nodeId: string) => void;
  onStatsUpdate?: (generation: number, totalNodes: number) => void;
  currentLine?: number;
  onNodeResize?: (width: number, height: number) => void;
}

export interface TreeNodeProps {
  node: d3.HierarchyNode<TreeNode>;
  boxWidth: number;
  boxHeight: number;
  onClick?: (node: TreeNode) => void;
  onStepNode?: (nodeId: string) => void;
  isHorizontalLayout?: boolean;
  currentLine?: number;
  onResize?: (width: number, height: number) => void;
  editorTheme?: string;
  showInlineVariables?: boolean;
}

export interface TreeLinkProps {
  link: d3.HierarchyLink<TreeNode>;
}

export interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
} 