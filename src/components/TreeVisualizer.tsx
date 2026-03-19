import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { TreeNode, TreeVisualizerProps } from '../types';
import TreeNodeComponent from './TreeNode';
import TreeLink from './TreeLink';
import ZoomControls from './ZoomControls';

interface NodePosition {
  x: number;
  y: number;
}

export const TreeVisualizer: React.FC<TreeVisualizerProps> = ({
  data,
  width = 800,
  height = 600,
  marginTop = 10,
  marginRight = 10,
  marginBottom = 10,
  marginLeft = 10,
  nodeRadius = 5,
  nodeColor = "#4287f5",
  linkColor = "#ccc",
  nodePadding = 10,
  boxWidth = 120,
  boxHeight = 50,
  nodeSeparation = 1.5,
  verticallyConstrained = true,
  isCompactMode = false,
  isHorizontalLayout = false,
  spacingMultiplier = 1.5,
  editorTheme = 'monokai',
  showInlineVariables = false,
  onNodeClick,
  onStepNode,
  onStatsUpdate,
  currentLine = -1,
  onNodeResize
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<d3.HierarchyNode<TreeNode>[]>([]);
  const [links, setLinks] = useState<d3.HierarchyLink<TreeNode>[]>([]);
  const [nodePositions, setNodePositions] = useState<{ [key: string]: NodePosition }>({});
  const [treeHeight, setTreeHeight] = useState<number>(0);
  const [treeWidth, setTreeWidth] = useState<number>(0);
  const previousNodesRef = useRef<{ [key: string]: NodePosition }>({});
  const [scale, setScale] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousNodeCountRef = useRef<number>(0);

  // Helper function to filter out terminated nodes from the tree
  const filterTerminatedNodes = (node: TreeNode): TreeNode | null => {
    // If this node is terminated, remove it (unless it's root)
    if (node.isTerminated && node.id !== 'root') {
      return null;
    }
    
    // Recursively filter children
    const filteredChildren = node.children
      ?.map(child => filterTerminatedNodes(child))
      .filter((child): child is TreeNode => child !== null);
    
    return {
      ...node,
      children: filteredChildren && filteredChildren.length > 0 ? filteredChildren : undefined
    };
  };

  useEffect(() => {
    // Store previous positions
    const oldPositions = { ...previousNodesRef.current };

    // Filter out terminated nodes before creating hierarchy
    const filteredData = filterTerminatedNodes(data) || data;

    // Create the root hierarchy
    const root = d3.hierarchy<TreeNode>(filteredData);
    
    // Node dimensions
    const nodeW = isHorizontalLayout ? boxHeight : boxWidth;
    const nodeH = isHorizontalLayout ? boxWidth : boxHeight;
    
    // Spacing based on multiplier (default 1.5x node size for comfortable viewing)
    const horizSpacing = nodeW * spacingMultiplier;
    const vertSpacing = nodeH * spacingMultiplier;
    
    // Create tree layout with default spacing - compact mode will scale after layout
    const layout = d3.tree<TreeNode>()
      .nodeSize(isHorizontalLayout ? [horizSpacing, vertSpacing] : [horizSpacing, vertSpacing]);

    // Compute the tree layout
    layout(root);

    // If horizontal layout, swap x and y coordinates
    if (isHorizontalLayout) {
      root.descendants().forEach(node => {
        const tempX = node.x;
        node.x = node.y;
        node.y = tempX;
      });
    }

    // Get node positions after layout
    const nodes = root.descendants();
    let yMin = d3.min(nodes, d => d.y) || 0;
    let yMax = d3.max(nodes, d => d.y) || 0;
    let xMin = d3.min(nodes, d => d.x) || 0;
    let xMax = d3.max(nodes, d => d.x) || 0;
    
    // In compact mode, scale positions to fit within viewport if needed
    // D3's tree layout may produce a wider tree than expected based on structure
    if (isCompactMode) {
      const actualTreeWidth = xMax - xMin;
      const actualTreeHeight = yMax - yMin;
      
      // Use margin that accounts for PID badge (22px) and runner button above nodes
      const compactMargin = 30;
      
      // Calculate available space (viewport minus margins and node size)
      // Node edges extend nodeW/2 beyond center on each side
      const availableForTreeX = width - compactMargin * 2 - nodeW;
      const availableForTreeY = height - compactMargin * 2 - nodeH;
      
      // Scale X positions if tree is wider than available space
      // Only scale if there's positive available space and tree is wider
      if (availableForTreeX > 0 && actualTreeWidth > 0 && actualTreeWidth > availableForTreeX) {
        const scaleX = availableForTreeX / actualTreeWidth;
        const centerX = (xMin + xMax) / 2;
        nodes.forEach(node => {
          if (typeof node.x === 'number') {
            // Scale relative to center
            node.x = centerX + (node.x - centerX) * scaleX;
          }
        });
        // Recalculate bounds
        xMin = d3.min(nodes, d => d.x) || 0;
        xMax = d3.max(nodes, d => d.x) || 0;
      }
      
      // Scale Y positions if tree is taller than available space
      if (availableForTreeY > 0 && actualTreeHeight > 0 && actualTreeHeight > availableForTreeY) {
        const scaleY = availableForTreeY / actualTreeHeight;
        nodes.forEach(node => {
          if (typeof node.y === 'number') {
            // Scale relative to root (yMin)
            node.y = yMin + (node.y - yMin) * scaleY;
          }
        });
        // Recalculate bounds
        yMin = d3.min(nodes, d => d.y) || 0;
        yMax = d3.max(nodes, d => d.y) || 0;
      }
    }
    
    // Position nodes:
    // - Root should be at a fixed position: centered for vertical, left-centered for horizontal
    // - After d3 layout, root is at (0, 0), children spread out from there
    // - Use small fixed margins to position near edges
    // 
    // IMPORTANT: TreeNode draws differently for each layout:
    // - Vertical layout: boxY = 0 (top edge at position), boxX = -boxWidth/2 (centered horizontally)
    // - Horizontal layout: boxX = 0 (left edge at position), boxY = -boxHeight/2 (centered vertically)
    
    // Edge margin must account for PID badge (22px above node) and runner button
    // Use 30px minimum to prevent clipping those elements
    const edgeMargin = 30;
    
    if (isHorizontalLayout) {
      // Horizontal: root at left, centered vertically in viewport
      // Node draws with left edge at position, so put position at edgeMargin
      const offsetX = edgeMargin - xMin;
      const offsetY = (height / 2) - (yMin + yMax) / 2;
      
      nodes.forEach(node => {
        if (typeof node.x === 'number') {
          node.x = node.x + offsetX;
        }
        if (typeof node.y === 'number') {
          node.y = node.y + offsetY;
        }
      });
    } else {
      // Vertical: root at top, centered horizontally
      // Node draws with TOP edge at position (boxY=0), boxX = -boxWidth/2 (centered)
      const offsetY = edgeMargin - yMin;
      
      // Center horizontally: node centers range from xMin to xMax
      // Node edges extend boxWidth/2 on each side
      // So we need leftmost edge at marginLeft + nodeW/2 and rightmost at width - marginRight - nodeW/2
      // Center of available area: marginLeft + nodeW/2 + (width - marginLeft - marginRight - nodeW) / 2
      //                         = marginLeft + nodeW/2 + availableWidth/2
      //                         = (width + marginLeft - marginRight) / 2
      // Actually simpler: center of viewport area accounting for node size
      const viewportCenterX = nodeW / 2 + (width - nodeW) / 2;  // = width / 2
      const treeCenterX = (xMin + xMax) / 2;
      const offsetX = viewportCenterX - treeCenterX;
      
      // But in compact mode, ensure nodes stay within bounds
      if (isCompactMode) {
        // Use same margin as scaling calculation for consistency
        const compactMargin = 30;
        
        // After offset, check if any node edge goes out of bounds
        const projectedXMin = xMin + offsetX;
        const projectedXMax = xMax + offsetX;
        const leftEdge = projectedXMin - nodeW / 2;
        const rightEdge = projectedXMax + nodeW / 2;
        
        // Adjust if needed to keep within bounds
        let adjustX = 0;
        if (leftEdge < compactMargin) {
          adjustX = compactMargin - leftEdge;
        } else if (rightEdge > width - compactMargin) {
          adjustX = (width - compactMargin) - rightEdge;
        }
        
        nodes.forEach(node => {
          if (typeof node.x === 'number') {
            node.x = node.x + offsetX + adjustX;
          }
          if (typeof node.y === 'number') {
            node.y = node.y + offsetY;
          }
        });
      } else {
        nodes.forEach(node => {
          if (typeof node.x === 'number') {
            node.x = node.x + offsetX;
          }
          if (typeof node.y === 'number') {
            node.y = node.y + offsetY;
          }
        });
      }
    }
    
    // NOW calculate the actual bounding box after positioning
    const finalXMin = d3.min(nodes, d => d.x) || 0;
    const finalXMax = d3.max(nodes, d => d.x) || 0;
    const finalYMin = d3.min(nodes, d => d.y) || 0;
    const finalYMax = d3.max(nodes, d => d.y) || 0;
    
    // SVG needs to fit all node edges + margin
    // TreeNode draws differently per layout:
    // - Vertical: boxX = -boxWidth/2 (centered), boxY = 0 (top at position)
    // - Horizontal: boxX = 0 (left at position), boxY = -boxHeight/2 (centered)
    let requiredWidth: number;
    let requiredHeight: number;
    
    if (isHorizontalLayout) {
      // Width: rightmost node position + nodeW (since left edge at position)
      // Height: need to fit from (yMin - nodeH/2) to (yMax + nodeH/2)
      requiredWidth = finalXMax + nodeW + edgeMargin;
      requiredHeight = Math.max(height, (finalYMax - finalYMin) + nodeH + edgeMargin * 2);
    } else {
      // Width: need to fit from (xMin - nodeW/2) to (xMax + nodeW/2)
      // Height: bottommost node position + nodeH (since top edge at position)
      requiredWidth = Math.max(width, (finalXMax - finalXMin) + nodeW + edgeMargin * 2);
      requiredHeight = finalYMax + nodeH + edgeMargin;
    }
    
    setTreeWidth(requiredWidth);
    setTreeHeight(requiredHeight);

    // Get new nodes and links
    const newNodes = root.descendants();
    const newLinks = root.links();

    // Calculate new positions
    const newPositions = newNodes.reduce((acc, node) => {
      const nodeId = node.data.id;
      const parentId = node.parent?.data.id;
      
      // If node exists in old positions, use that as starting point
      const startPos = oldPositions[nodeId] || 
        (parentId && oldPositions[parentId]) || 
        { x: marginLeft + (isHorizontalLayout ? boxHeight : boxWidth)/2, y: marginTop };

      // Store final position
      acc[nodeId] = {
        x: typeof node.x === 'number' ? node.x : startPos.x,
        y: typeof node.y === 'number' ? node.y : startPos.y
      };
      
      return acc;
    }, {} as { [key: string]: NodePosition });

    // Update state
    setNodes(newNodes);
    setLinks(newLinks);
    setNodePositions(newPositions);
    previousNodesRef.current = newPositions;

    if (onStatsUpdate) {
      onStatsUpdate(root.height || 0, newNodes.length);
    }

    previousNodeCountRef.current = newNodes.length;

  }, [data, width, height, boxWidth, boxHeight, marginTop, marginBottom, marginLeft, marginRight, isCompactMode, isHorizontalLayout, spacingMultiplier]);

  // Calculate SVG dimensions based on tree size and scale
  const svgDimensions = useMemo(() => {
    // Set a minimum width and height (viewport size)
    const minWidth = width;
    const minHeight = height;
    
    // Use tree dimensions directly - they already account for node sizes and margins
    // Scale affects the content transform, so we need to account for it
    const scaledTreeWidth = treeWidth * scale;
    const scaledTreeHeight = treeHeight * scale;
    
    return {
      width: Math.max(minWidth, scaledTreeWidth),
      height: Math.max(minHeight, scaledTreeHeight)
    };
  }, [width, height, treeWidth, treeHeight, scale]);

  // Calculate transform for the content group (handles zoom)
  const contentTransform = useMemo(() => {
    // In compact mode, spacing is already adjusted - no transform needed
    // Just apply zoom scale from zoom controls
    return `scale(${scale})`;
  }, [scale]);

  // Zoom control handlers
  const handleZoomIn = () => {
    setScale(prevScale => Math.min(2, prevScale * 1.2));
  };

  const handleZoomOut = () => {
    setScale(prevScale => Math.max(0.5, prevScale * 0.8));
  };

  const handleReset = () => {
    setScale(1);
  };

  return (
    <div style={{ 
      position: 'relative',
      height: '100%', 
      display: 'flex',
      flexDirection: 'column',
      padding: 0,
      margin: 0,
      width: '100%',
      overflow: 'hidden'
    }}>
      <div
        ref={containerRef}
        className={`tree-visualizer ${isCompactMode ? 'compact' : ''}`}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          flex: 1,
          overflow: isCompactMode ? 'hidden auto' : 'auto',
          border: '1px solid #ccc',
          borderRadius: '4px',
          background: 'white',
          boxSizing: 'border-box',
          margin: 0,
          padding: 0
        }}
      >
        <svg
          ref={svgRef}
          width={svgDimensions.width}
          height={svgDimensions.height}
          className="tree-svg"
          style={{
            display: 'block',
            minHeight: '100%'
          }}
        >
          {/* Add light grey background with grid */}
          <defs>
            <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e0e0e0" strokeWidth="1" strokeDasharray="2,2"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="#f5f5f5" />
          <rect width="100%" height="100%" fill="url(#grid)" />
          
          <g transform={contentTransform}>
            {links.map((link) => {
              const sourcePos = nodePositions[link.source.data.id];
              const targetPos = nodePositions[link.target.data.id];
              return sourcePos && targetPos ? (
                <TreeLink
                  key={link.target.data.id}
                  link={link}
                  sourceX={sourcePos.x}
                  sourceY={sourcePos.y}
                  targetX={targetPos.x}
                  targetY={targetPos.y}
                  isHorizontalLayout={isHorizontalLayout}
                />
              ) : null;
            })}
            {nodes.map((node) => {
              const pos = nodePositions[node.data.id];
              return pos ? (
                <g
                  key={node.data.id}
                  className="node-group"
                  style={{ 
                    transform: `translate(${pos.x}px,${pos.y}px)`,
                    transition: 'all 750ms cubic-bezier(0.4, 0, 0.2, 1)'
                  }}
                >
                  <TreeNodeComponent
                    node={node}
                    boxWidth={boxWidth}
                    boxHeight={boxHeight}
                    onClick={onNodeClick}
                    onStepNode={onStepNode}
                    isHorizontalLayout={isHorizontalLayout}
                    currentLine={currentLine}
                    onResize={onNodeResize}
                    editorTheme={editorTheme}
                    showInlineVariables={showInlineVariables}
                  />
                </g>
              ) : null;
            })}
          </g>
        </svg>
      </div>
      
      {/* Position ZoomControls outside the scrollable container */}
      <ZoomControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleReset}
      />
    </div>
  );
}; 