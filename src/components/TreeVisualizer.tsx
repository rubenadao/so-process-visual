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
  onNodeClick,
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

  useEffect(() => {
    // Store previous positions
    const oldPositions = { ...previousNodesRef.current };

    // Create the root hierarchy
    const root = d3.hierarchy<TreeNode>(data);

    // Create tree layout
    const layout = d3.tree<TreeNode>()
      .nodeSize(isHorizontalLayout ? [boxHeight * 1.5, boxWidth * 1.5] : [boxWidth * 1.5, boxHeight * 1.5]);

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

    // Calculate actual tree dimensions
    const nodes = root.descendants();
    const yMin = d3.min(nodes, d => d.y) || 0;
    const yMax = d3.max(nodes, d => d.y) || 0;
    const xMin = d3.min(nodes, d => d.x) || 0;
    const xMax = d3.max(nodes, d => d.x) || 0;
    
    const actualTreeHeight = yMax - yMin + (isHorizontalLayout ? boxWidth : boxHeight) * 2;
    const actualTreeWidth = xMax - xMin + (isHorizontalLayout ? boxHeight : boxWidth);
    
    setTreeHeight(actualTreeHeight);
    setTreeWidth(actualTreeWidth);

    // Center the tree for both modes
    if (isCompactMode) {
      // Compact mode: scale horizontally to fit width
      const availableWidth = width - marginLeft - marginRight - (isHorizontalLayout ? boxHeight : boxWidth);
      const scale = availableWidth / (xMax - xMin);
      
      nodes.forEach(node => {
        if (typeof node.x === 'number') {
          node.x = (node.x - xMin) * scale + marginLeft + (isHorizontalLayout ? boxHeight : boxWidth)/2;
        }
        if (typeof node.y === 'number') {
          // Shift all nodes up by yMin to start from 0, then add top margin
          node.y = node.y - yMin + marginTop;
        }
      });
    } else {
      // Normal mode: ensure nodes are fully visible with padding
      const xOffset = marginLeft + (isHorizontalLayout ? boxHeight : boxWidth)/2 - xMin;
      nodes.forEach(node => {
        if (typeof node.x === 'number') {
          node.x += xOffset;
        }
        if (typeof node.y === 'number') {
          // Shift all nodes up by yMin to start from 0, then add top margin
          node.y = node.y - yMin + marginTop;
        }
      });
    }

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

  }, [data, width, height, boxWidth, boxHeight, marginTop, marginLeft, marginRight, isCompactMode, isHorizontalLayout]);

  // Calculate SVG dimensions based on tree size and scale
  const svgDimensions = useMemo(() => {
    // Set a minimum width and height
    const minWidth = width;
    const minHeight = height;
    
    // Calculate actual dimensions based on tree size and scale
    const actualWidth = Math.max(minWidth, treeWidth * scale + marginLeft + marginRight);
    const actualHeight = Math.max(minHeight, treeHeight * scale + marginTop + marginBottom);
    
    return {
      width: actualWidth,
      height: actualHeight
    };
  }, [width, height, treeWidth, treeHeight, scale, marginLeft, marginRight, marginTop, marginBottom]);

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
          
          <g transform={`scale(${scale})`}>
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
                    isHorizontalLayout={isHorizontalLayout}
                    currentLine={currentLine}
                    onResize={onNodeResize}
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