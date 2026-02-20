// mov-abs-elems.js
// Handles drag-and-drop functionality and communication with the VS Code extension

(function() {
  'use strict';

  const VSCODE_SERVER_URL = 'http://localhost:37842';
  let draggedElement = null;
  let draggedOverlay = null;
  let offsetX = 0;
  let offsetY = 0;
  let parentRect = null;
  let parentElement = null;
  // Track the currently active overlay globally
  let currentActiveOverlay = null;
  let isDragging = false;
  let isResizing = false;
  let resizeHandle = null;
  let resizeStartRect = null;  // Element rect at resize start
  let resizeStartMouse = null; // Mouse position at the start of resizing
  let currentMouseUpHandler = null;
  let dragStartPos = null; // Drag start position
  const DRAG_THRESHOLD = 0.1; // Do not treat it as a drag if moved less than 0.1%
  
  // History stack for Undo/Redo
  let historyStack = [];
  let historyIndex = -1;
  const MAX_HISTORY = 1000;
  
  // Manages edit mode state
  let editMode = true;
  let undoRedoPanel = null;
  let isPanelDragging = false;
  let panelOffsetX = 0;
  let panelOffsetY = 0;
  
  function createUndoRedoPanel() {
    if (undoRedoPanel) return;
    
    undoRedoPanel = document.createElement('div');
    undoRedoPanel.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      color: white;
      padding: 10px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 999999;
      display: none;
      cursor: move;
      user-select: none;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    
    undoRedoPanel.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center;">
        <button id="undo-btn" style="
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: white;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: background 0.2s;
        " title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button id="redo-btn" style="
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: white;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: background 0.2s;
        " title="Redo (Ctrl+Y)">
          ↷ Redo
        </button>
        <span style="font-size: 12px; opacity: 0.7; margin-left: 4px;">
          History: <span id="history-info">0/0</span>
        </span>
      </div>
    `;
    
    document.body.appendChild(undoRedoPanel);
    
    // Button events
    const undoBtn = undoRedoPanel.querySelector('#undo-btn');
    const redoBtn = undoRedoPanel.querySelector('#redo-btn');
    
    undoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      undo();
    });
    
    redoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      redo();
    });
    
    // Hover effects
    undoBtn.addEventListener('mouseenter', () => {
      undoBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    });
    undoBtn.addEventListener('mouseleave', () => {
      undoBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    });
    
    redoBtn.addEventListener('mouseenter', () => {
      redoBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    });
    redoBtn.addEventListener('mouseleave', () => {
      redoBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    });
    
    // Handle panel dragging
    undoRedoPanel.addEventListener('mousedown', (e) => {
      // Do not start dragging when a button is clicked
      if (e.target.tagName === 'BUTTON') return;
      
      isPanelDragging = true;
      const rect = undoRedoPanel.getBoundingClientRect();
      panelOffsetX = e.clientX - rect.left;
      panelOffsetY = e.clientY - rect.top;
      
      undoRedoPanel.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isPanelDragging) return;
      
      const x = e.clientX - panelOffsetX;
      const y = e.clientY - panelOffsetY;
      
      // Keep within the viewport
      const maxX = window.innerWidth - undoRedoPanel.offsetWidth;
      const maxY = window.innerHeight - undoRedoPanel.offsetHeight;
      
      const finalX = Math.max(0, Math.min(x, maxX));
      const finalY = Math.max(0, Math.min(y, maxY));
      
      undoRedoPanel.style.left = `${finalX}px`;
      undoRedoPanel.style.top = `${finalY}px`;
      undoRedoPanel.style.right = 'auto';
      undoRedoPanel.style.bottom = 'auto';
    });
    
    document.addEventListener('mouseup', () => {
      if (isPanelDragging) {
        isPanelDragging = false;
        undoRedoPanel.style.cursor = 'move';
      }
    });
  }
  
  function updateHistoryInfo() {
    if (!undoRedoPanel) {
      console.log('[updateHistoryInfo] Panel not found');
      return;
    }
    
    const historyInfo = undoRedoPanel.querySelector('#history-info');
    if (historyInfo) {
      historyInfo.textContent = `${historyIndex + 1}/${historyStack.length}`;
    }
    
    console.log(`[updateHistoryInfo] historyIndex=${historyIndex}, historyStack.length=${historyStack.length}`);
    
    // Update the buttons' enabled/disabled state
    const undoBtn = undoRedoPanel.querySelector('#undo-btn');
    const redoBtn = undoRedoPanel.querySelector('#redo-btn');
    
    if (undoBtn) {
      const canUndo = historyIndex >= 0;
      undoBtn.disabled = !canUndo;
      undoBtn.style.opacity = canUndo ? '1' : '0.5';
      undoBtn.style.cursor = canUndo ? 'pointer' : 'not-allowed';
      console.log(`[updateHistoryInfo] Undo button: ${canUndo ? 'enabled' : 'disabled'}`);
    }
    
    if (redoBtn) {
      const canRedo = historyIndex < historyStack.length - 1;
      redoBtn.disabled = !canRedo;
      redoBtn.style.opacity = canRedo ? '1' : '0.5';
      redoBtn.style.cursor = canRedo ? 'pointer' : 'not-allowed';
      console.log(`[updateHistoryInfo] Redo button: ${canRedo ? 'enabled' : 'disabled'}`);
    }
  }
  
  function toggleEditMode() {
    editMode = !editMode;
    
    if (!undoRedoPanel) {
      createUndoRedoPanel();
    }
    
    if (editMode) {
      // Enable edit mode
      const allOverlays = document.querySelectorAll('.quarto-drag-overlay');
      
      allOverlays.forEach(overlay => {
        // If the element is inside a slide, check whether it belongs to the current slide
        const targetIndex = overlay.getAttribute('data-target-index');
        const overlayElement = document.querySelector(`[data-html-index="${targetIndex}"]`);
        
        if (overlayElement) {
          const slide = overlayElement.closest('section.slide');
          if (slide) {
            // Elements inside slides: display only if the slide is currently active
            if (slide.classList.contains('present')) {
              overlay.style.display = '';
            } else {
              overlay.style.display = 'none';
            }
          } else {
            // Elements outside slides: always display
            overlay.style.display = '';
          }
        } else {
          // Show even if the target element cannot be found
          overlay.style.display = '';
        }
      });
      
      //Display Undo/Redo panel
      undoRedoPanel.style.display = 'block';
      updateHistoryInfo();
      
      showNotification('Edit mode: ON', 'success');
      log('[Edit Mode] Enabled');
    } else {
      // Disable edit mode
      const allOverlays = document.querySelectorAll('.quarto-drag-overlay');
      allOverlays.forEach(overlay => {
        overlay.style.display = 'none';
      });
      
      // Hide Undo/Redo panel
      undoRedoPanel.style.display = 'none';
      
      // Reset the active overlay
      clearActiveOverlay();
      showNotification('Edit mode: OFF', 'info');
      log('[Edit Mode] Disabled');
    }
  }
    
  function log(...args) {
    if (editMode) {
      console.log(...args);
    }
  }
  
  function setActiveOverlay(overlay, element) {
    // Do not change while dragging or resizing
    if (isDragging || isResizing) {
      return;
    }
    
    // Deactivate the previous active overlay
    if (currentActiveOverlay && currentActiveOverlay !== overlay) {
      currentActiveOverlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
      currentActiveOverlay.style.background = 'rgba(255, 0, 0, 0.1)';
      currentActiveOverlay.style.boxShadow = 'none';
      // Hide resize handles
      const handles = currentActiveOverlay.querySelectorAll('.resize-handle');
      handles.forEach(h => h.style.display = 'none');
    }
    
    // Activate the new overlay
    overlay.style.border = '1px dashed rgba(0, 123, 255, 0.7)';
    overlay.style.background = 'rgba(0, 123, 255, 0.15)';
    
    // Show resize handles
    const handles = overlay.querySelectorAll('.resize-handle');
    handles.forEach(h => h.style.display = 'block');
    
    // Add shadow for thin elements (accounting for rotation)
    if (element) {
      const computedStyle = window.getComputedStyle(element);
      const elementRect = element.getBoundingClientRect();
      
      // Get actual width and height (before rotation)
      let actualWidth = parseFloat(computedStyle.width);
      let actualHeight = parseFloat(computedStyle.height);
      
      // If border-bottom exists, height may be very small
      const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;
      if (borderBottom > 0 && actualHeight < 10) {
        actualHeight = borderBottom;
      }
      
      // Determine based on pre-rotation size
      if (actualHeight < 10 || actualWidth < 10) {
        overlay.style.boxShadow = '0 0 8px 2px rgba(0, 123, 255, 0.6)';
      }
    }
    
    currentActiveOverlay = overlay;
  }  

  function clearActiveOverlay() {
    // Do not change while dragging or resizing
    if (isDragging || isResizing) {
      return;
    }
    
    if (currentActiveOverlay) {
      currentActiveOverlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
      currentActiveOverlay.style.background = 'rgba(255, 0, 0, 0.1)';
      currentActiveOverlay.style.boxShadow = 'none';
      // Hide resize handles
      const handles = currentActiveOverlay.querySelectorAll('.resize-handle');
      handles.forEach(h => h.style.display = 'none');
      currentActiveOverlay = null;
    }
  }

  function getQmdFileName() {
    const url = window.location.pathname;
    const fileName = url.split('/').pop().replace(/\.html$/, '.qmd');
    return fileName;
  }

  function addToHistory(action) {
    // Clear future history beyond the current position
    if (historyIndex < historyStack.length - 1) {
      console.log(`[History] Clearing future history from index ${historyIndex + 1} to ${historyStack.length - 1}`);
      historyStack = historyStack.slice(0, historyIndex + 1);
    }
    
    // Add new action
    historyStack.push(action);
    historyIndex++;
    
    // Remove oldest entry if history exceeds max size
    if (historyStack.length > MAX_HISTORY) {
      historyStack.shift();
      historyIndex--;
    }
    
    console.log(`[History] Added action, stack size: ${historyStack.length}, index: ${historyIndex}`);
    console.log(`[History] New action:`, {
      type: action.type,
      oldTop: action.oldTop,
      oldLeft: action.oldLeft,
      newTop: action.newTop,
      newLeft: action.newLeft
    });
    
    // Update history info
    updateHistoryInfo();
  }

  async function undo() {
    if (historyIndex < 0) {
      showNotification('Cannot undo any further', 'info');
      return;
    }
    
    const action = historyStack[historyIndex];
    console.log(`[History] Undoing action at index ${historyIndex}:`, action);
    
    // Call VSCode Undo API
    try {
      const fileName = getQmdFileName();
      const response = await fetch(`${VSCODE_SERVER_URL}/undo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: fileName
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.error('Server undo error:', error);
        throw new Error(error.error || 'Failed to undo on server');
      }
      
      console.log('[History] VSCode undo successful');
    } catch (error) {
      console.error('Failed to notify VSCode of undo:', error);
      showNotification('Failed to sync with VSCode', 'error');
      historyIndex++;
      updateHistoryInfo();
      return;
    }
    
    // Round values
    const roundedOldTop = Math.round(action.oldTop * 10) / 10;
    const roundedOldLeft = Math.round(action.oldLeft * 10) / 10;
    
    // Revert DOM state (always update data attributes as well)
    if (action.type === 'position') {
      action.element.style.top = `${roundedOldTop}%`;
      action.element.style.left = `${roundedOldLeft}%`;
      action.element.setAttribute('data-top', `${roundedOldTop}%`);
      action.element.setAttribute('data-left', `${roundedOldLeft}%`);
      
      // Update overlay for IMG elements
      if (action.element.tagName === 'IMG') {
        // Recalculate overlay accounting for parent influence
        setTimeout(() => recalculateImageOverlay(action.element), 0);
      }
      
      console.log(`[History] Undo position - restored to top=${roundedOldTop}%, left=${roundedOldLeft}%`);

    } else if (action.type === 'size') {
      const roundedOldTop = action.oldTop !== null ? Math.round(action.oldTop * 10) / 10 : null;
      const roundedOldLeft = action.oldLeft !== null ? Math.round(action.oldLeft * 10) / 10 : null;
      const roundedOldBottom = action.oldBottom !== null ? Math.round(action.oldBottom * 10) / 10 : null;
      const roundedOldRight = action.oldRight !== null ? Math.round(action.oldRight * 10) / 10 : null;
      const roundedOldWidth = action.oldWidth !== null ? Math.round(action.oldWidth * 10) / 10 : null;
      const roundedOldHeight = action.oldHeight !== null ? Math.round(action.oldHeight * 10) / 10 : null;
      
      // Restore position
      if (roundedOldTop !== null) {
        action.element.style.top = `${roundedOldTop}%`;
        action.element.setAttribute('data-top', `${roundedOldTop}%`);
      } else {
        action.element.style.removeProperty('top');
        action.element.removeAttribute('data-top');
      }
      
      if (roundedOldLeft !== null) {
        action.element.style.left = `${roundedOldLeft}%`;
        action.element.setAttribute('data-left', `${roundedOldLeft}%`);
      } else {
        action.element.style.removeProperty('left');
        action.element.removeAttribute('data-left');
      }
      
      if (roundedOldBottom !== null) {
        action.element.style.bottom = `${roundedOldBottom}%`;
        action.element.setAttribute('data-bottom', `${roundedOldBottom}%`);
      } else {
        action.element.style.removeProperty('bottom');
        action.element.removeAttribute('data-bottom');
      }
      
      if (roundedOldRight !== null) {
        action.element.style.right = `${roundedOldRight}%`;
        action.element.setAttribute('data-right', `${roundedOldRight}%`);
      } else {
        action.element.style.removeProperty('right');
        action.element.removeAttribute('data-right');
      }
      
      // Restore size
      if (roundedOldWidth !== null) {
        action.element.style.width = `${roundedOldWidth}%`;
        action.element.setAttribute('data-width', `${roundedOldWidth}%`);
      } else {
        action.element.style.removeProperty('width');
        action.element.removeAttribute('data-width');
      }
      
      if (roundedOldHeight !== null) {
        action.element.style.height = `${roundedOldHeight}%`;
        action.element.setAttribute('data-height', `${roundedOldHeight}%`);
      } else {
        action.element.style.removeProperty('height');
        action.element.removeAttribute('data-height');
      }
      
      console.log(`[History] Undo size - restored to top=${roundedOldTop}, left=${roundedOldLeft}, bottom=${roundedOldBottom}, right=${roundedOldRight}, width=${roundedOldWidth}, height=${roundedOldHeight}`);
      
      // Update overlay
      if (action.element.tagName === 'IMG') {
        // Recalculate overlay accounting for parent influence
        setTimeout(() => recalculateImageOverlay(action.element), 0);
      }
      // DIV overlays automatically cover the entire element — no action needed
    }
    
    // Decrement history index
    historyIndex--;
    
    console.log(`[History] After undo: historyIndex=${historyIndex}, updated data-top=${action.element.getAttribute('data-top')}, data-left=${action.element.getAttribute('data-left')}`);
    showNotification('Undo successful', 'success');
    
    // Update history info
    updateHistoryInfo();
  }

  async function redo() {
    if (historyIndex >= historyStack.length - 1) {
      showNotification('Nothing left to redo', 'info');
      return;
    }
    
    historyIndex++;
    const action = historyStack[historyIndex];
    console.log(`[History] Redoing action at index ${historyIndex}:`, action);
    
    // Call VSCode Redo API
    try {
      const fileName = getQmdFileName();
      const response = await fetch(`${VSCODE_SERVER_URL}/redo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: fileName
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.error('Server redo error:', error);
        throw new Error(error.error || 'Failed to redo on server');
      }
      
      console.log('[History] VSCode redo successful');
    } catch (error) {
      console.error('Failed to notify VSCode of redo:', error);
      showNotification('Failed to sync with VSCode', 'error');
      historyIndex--;
      updateHistoryInfo();
      return;
    }
    
    // Round values
    const roundedNewTop = Math.round(action.newTop * 10) / 10;
    const roundedNewLeft = Math.round(action.newLeft * 10) / 10;
    
    // Redo in the DOM (always update data attributes as well)
    if (action.type === 'position') {
      action.element.style.top = `${roundedNewTop}%`;
      action.element.style.left = `${roundedNewLeft}%`;
      action.element.setAttribute('data-top', `${roundedNewTop}%`);
      action.element.setAttribute('data-left', `${roundedNewLeft}%`);
      
      // Update overlay for IMG elements
      if (action.element.tagName === 'IMG') {
        const overlay = document.querySelector(`[data-target-index="${action.element.getAttribute('data-html-index')}"]`);
        if (overlay) {
          overlay.style.top = `${roundedNewTop}%`;
          overlay.style.left = `${roundedNewLeft}%`;
        }
      }
      
      console.log(`[History] Redo position - restored to top=${roundedNewTop}%, left=${roundedNewLeft}%`);

    } else if (action.type === 'size') {
      const roundedNewTop = action.newTop !== null ? Math.round(action.newTop * 10) / 10 : null;
      const roundedNewLeft = action.newLeft !== null ? Math.round(action.newLeft * 10) / 10 : null;
      const roundedNewWidth = action.newWidth !== null ? Math.round(action.newWidth * 10) / 10 : null;
      const roundedNewHeight = action.newHeight !== null ? Math.round(action.newHeight * 10) / 10 : null;
      
      if (roundedNewTop !== null) {
        action.element.style.top = `${roundedNewTop}%`;
        action.element.setAttribute('data-top', `${roundedNewTop}%`);
      } else {
        action.element.style.removeProperty('top');
        action.element.removeAttribute('data-top');
      }
      
      if (roundedNewLeft !== null) {
        action.element.style.left = `${roundedNewLeft}%`;
        action.element.setAttribute('data-left', `${roundedNewLeft}%`);
      } else {
        action.element.style.removeProperty('left');
        action.element.removeAttribute('data-left');
      }
      
      action.element.style.removeProperty('bottom');
      action.element.removeAttribute('data-bottom');
      action.element.style.removeProperty('right');
      action.element.removeAttribute('data-right');
      
      if (roundedNewWidth !== null) {
        action.element.style.width = `${roundedNewWidth}%`;
        action.element.setAttribute('data-width', `${roundedNewWidth}%`);
      } else {
        action.element.style.removeProperty('width');
        action.element.removeAttribute('data-width');
      }
      
      if (roundedNewHeight !== null) {
        action.element.style.height = `${roundedNewHeight}%`;
        action.element.setAttribute('data-height', `${roundedNewHeight}%`);
      } else {
        action.element.style.removeProperty('height');
        action.element.removeAttribute('data-height');
      }
      
      console.log(`[History] Redo size - restored to top=${roundedNewTop}, left=${roundedNewLeft}, width=${roundedNewWidth}, height=${roundedNewHeight}`);
      
      // Update overlay
      if (action.element.tagName === 'IMG') {
        // Recalculate overlay accounting for parent influence
        setTimeout(() => recalculateImageOverlay(action.element), 0);
      }
    }
    
    console.log(`[History] After redo: historyIndex=${historyIndex}, updated data-top=${action.element.getAttribute('data-top')}, data-left=${action.element.getAttribute('data-left')}`);
    showNotification('Redo successful', 'success');
    
    // Update history info
    updateHistoryInfo();
    
    // Attempt to restore focus
    window.focus();
    document.body.focus();
  }

  async function applyPositionChange(element, top, left, addToHistoryFlag = true) {
    const mdIndex = parseInt(element.getAttribute('data-md-index') || '0', 10);
    const classList = Array.from(element.classList).filter(c => c !== 'absolute');
    const currentTop = element.getAttribute('data-top');
    const currentLeft = element.getAttribute('data-left');
    
    // Skip if current and new values are the same
    const currentTopNum = currentTop ? parseFloat(currentTop) : 0;
    const currentLeftNum = currentLeft ? parseFloat(currentLeft) : 0;
    if (Math.abs(currentTopNum - top) < 0.01 && Math.abs(currentLeftNum - left) < 0.01) {
      return;
    }
    
    // Update DOM
    element.style.top = `${top}%`;
    element.style.left = `${left}%`;
    element.setAttribute('data-top', `${top}%`);
    element.setAttribute('data-left', `${left}%`);
    
    // Update overlay for IMG elements
    if (element.tagName === 'IMG') {
      const overlay = document.querySelector(`[data-target-index="${element.getAttribute('data-html-index')}"]`);
      if (overlay) {
        overlay.style.top = `${top}%`;
        overlay.style.left = `${left}%`;
      }
    }
    
    // Notify VSCode
    await sendPositionUpdate(mdIndex, top, left, currentTop, currentLeft, classList, addToHistoryFlag);
  }

  async function applySizeChange(element, top, left, width, height, addToHistoryFlag = true) {
    const mdIndex = parseInt(element.getAttribute('data-md-index') || '0', 10);
    const classList = Array.from(element.classList).filter(c => c !== 'absolute');
    const currentTop = element.getAttribute('data-top');
    const currentLeft = element.getAttribute('data-left');
    const currentWidth = element.getAttribute('data-width');
    const currentHeight = element.getAttribute('data-height');
    
    // Update DOM
    element.style.top = `${top}%`;
    element.style.left = `${left}%`;
    element.style.width = `${width}%`;
    element.style.height = `${height}%`;
    element.setAttribute('data-top', `${top}%`);
    element.setAttribute('data-left', `${left}%`);
    element.setAttribute('data-width', `${width}%`);
    element.setAttribute('data-height', `${height}%`);
    
    // Update overlay for IMG elements
    if (element.tagName === 'IMG') {
      const overlay = document.querySelector(`[data-target-index="${element.getAttribute('data-html-index')}"]`);
      if (overlay) {
        overlay.style.top = `${top}%`;
        overlay.style.left = `${left}%`;
        overlay.style.width = `${width}%`;
        overlay.style.height = `${height}%`;
      }
    }
    
    // Notify VSCode
    await sendSizeUpdate(mdIndex, top, left, width, height, currentTop, currentLeft, currentWidth, currentHeight, classList, addToHistoryFlag);
  }

  function createResizeHandles(overlay, element) {
    const positions = ['nw', 'ne', 'sw', 'se'];
    
    positions.forEach(pos => {
      const handle = document.createElement('div');
      handle.className = `resize-handle resize-${pos}`;
      handle.style.cssText = `
        position: absolute !important;
        width: 10px !important;
        height: 10px !important;
        background: rgba(0, 123, 255, 0.8) !important;
        border: 1px solid white !important;
        display: none !important;
        z-index: 10 !important;
        box-sizing: border-box !important;
      `;
      
      // Set position
      if (pos.includes('n')) handle.style.top = '-5px';
      if (pos.includes('s')) handle.style.bottom = '-5px';
      if (pos.includes('w')) handle.style.left = '-5px';
      if (pos.includes('e')) handle.style.right = '-5px';
      
      // Set cursor
      if (pos === 'nw' || pos === 'se') handle.style.cursor = 'nwse-resize';
      if (pos === 'ne' || pos === 'sw') handle.style.cursor = 'nesw-resize';
      
      handle.setAttribute('data-position', pos);
      
      // Resize handle event listener
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onResizeStart(e, element, overlay, pos);
      });
      
      overlay.appendChild(handle);
    });
  }

  function onResizeStart(e, element, overlay, position) {
    if (isResizing || isDragging) return;
    
    isResizing = true;
    resizeHandle = position;
    draggedElement = element;
    draggedOverlay = overlay;
    
    // Get parent element
    if (element.tagName === 'IMG') {
      parentElement = overlay.parentElement;
    } else {
      parentElement = element.parentElement;
      while (parentElement && parentElement !== document.body) {
        if (parentElement.hasAttribute('data-draggable')) {
          break;
        }
        parentElement = parentElement.parentElement;
      }
      if (!parentElement || parentElement === document.body) {
        parentElement = element.offsetParent || document.body;
      }
    }
    
    parentRect = parentElement.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    
    // Get values from data attributes
    const dataTop = element.getAttribute('data-top');
    const dataLeft = element.getAttribute('data-left');
    const dataBottom = element.getAttribute('data-bottom');
    const dataRight = element.getAttribute('data-right');
    const dataWidth = element.getAttribute('data-width');
    const dataHeight = element.getAttribute('data-height');
    
    // Calculate top and left (use data attributes if available, otherwise compute)
    let parsedTop = null;
    let parsedLeft = null;
    let parsedBottom = null;
    let parsedRight = null;
    
    if (dataTop) {
      parsedTop = parseFloat(dataTop.replace('%', ''));
    } else if (dataBottom) {
      parsedBottom = parseFloat(dataBottom.replace('%', ''));
      // Derive top from bottom
      parsedTop = 100 - parsedBottom - (rect.height / parentRect.height) * 100;
    } else {
      parsedTop = ((rect.top - parentRect.top) / parentRect.height) * 100;
    }
    
    if (dataLeft) {
      parsedLeft = parseFloat(dataLeft.replace('%', ''));
    } else if (dataRight) {
      parsedRight = parseFloat(dataRight.replace('%', ''));
      // Derive left from right
      parsedLeft = 100 - parsedRight - (rect.width / parentRect.width) * 100;
    } else {
      parsedLeft = ((rect.left - parentRect.left) / parentRect.width) * 100;
    }
    
    // Use data attributes for width and height if available, otherwise compute
    const parsedWidth = dataWidth ? parseFloat(dataWidth.replace('%', '')) : (rect.width / parentRect.width) * 100;
    const parsedHeight = dataHeight ? parseFloat(dataHeight.replace('%', '')) : (rect.height / parentRect.height) * 100;
    
    resizeStartRect = {
      top: Math.round(parsedTop * 10) / 10,
      left: Math.round(parsedLeft * 10) / 10,
      width: Math.round(parsedWidth * 10) / 10,
      height: Math.round(parsedHeight * 10) / 10,
      // Track which attributes were originally set
      hadTop: !!dataTop,
      hadLeft: !!dataLeft,
      hadBottom: !!dataBottom,
      hadRight: !!dataRight,
      hadWidth: !!dataWidth,
      hadHeight: !!dataHeight
    };
    
    console.log(`[Resize Start] top=${resizeStartRect.top}%, left=${resizeStartRect.left}%, width=${resizeStartRect.width}%, height=${resizeStartRect.height}%, hadTop=${resizeStartRect.hadTop}, hadLeft=${resizeStartRect.hadLeft}, hadBottom=${resizeStartRect.hadBottom}, hadRight=${resizeStartRect.hadRight}, hadWidth=${resizeStartRect.hadWidth}, hadHeight=${resizeStartRect.hadHeight}`);
    
    resizeStartMouse = {
      x: e.clientX,
      y: e.clientY
    };
    
    element.style.opacity = '0.8';
    
    document.addEventListener('mousemove', onResizeMove);
    
    if (currentMouseUpHandler) {
      document.removeEventListener('mouseup', currentMouseUpHandler);
    }
    
    currentMouseUpHandler = onResizeEnd;
    document.addEventListener('mouseup', currentMouseUpHandler);
  }

  function onResizeMove(e) {
    if (!isResizing || !draggedElement || !parentRect) return;
    
    const deltaX = ((e.clientX - resizeStartMouse.x) / parentRect.width) * 100;
    const deltaY = ((e.clientY - resizeStartMouse.y) / parentRect.height) * 100;
    
    let newTop = resizeStartRect.top;
    let newLeft = resizeStartRect.left;
    let newWidth = resizeStartRect.width;
    let newHeight = resizeStartRect.height;
    
    // Adjust size and position based on which corner is being dragged
    if (resizeHandle.includes('n')) {
      newTop = resizeStartRect.top + deltaY;
      newHeight = resizeStartRect.height - deltaY;
    }
    if (resizeHandle.includes('s')) {
      newHeight = resizeStartRect.height + deltaY;
    }
    if (resizeHandle.includes('w')) {
      newLeft = resizeStartRect.left + deltaX;
      newWidth = resizeStartRect.width - deltaX;
    }
    if (resizeHandle.includes('e')) {
      newWidth = resizeStartRect.width + deltaX;
    }
    
    // Enforce minimum size (1%)
    if (newWidth < 1) newWidth = 1;
    if (newHeight < 1) newHeight = 1;
    
    // Apply styles
    draggedElement.style.top = `${newTop}%`;
    draggedElement.style.left = `${newLeft}%`;
    draggedElement.style.width = `${newWidth}%`;
    draggedElement.style.height = `${newHeight}%`;
    
    // Update overlay for IMG elements
    if (draggedElement.tagName === 'IMG' && draggedOverlay) {
      draggedOverlay.style.top = `${newTop}%`;
      draggedOverlay.style.left = `${newLeft}%`;
      draggedOverlay.style.width = `${newWidth}%`;
      draggedOverlay.style.height = `${newHeight}%`;
    }
  }

  async function onResizeEnd(e) {
    document.removeEventListener('mousemove', onResizeMove);
    if (currentMouseUpHandler) {
      document.removeEventListener('mouseup', currentMouseUpHandler);
      currentMouseUpHandler = null;
    }
    
    if (!draggedElement || !parentRect) {
      isResizing = false;
      return;
    }
    
    if (draggedElement.dataset.updating === 'true') {
      isResizing = false;
      return;
    }
    
    // Check for position attributes
    const hasPosition = draggedElement.style.top || draggedElement.style.left || 
                      draggedElement.style.bottom || draggedElement.style.right ||
                      draggedElement.getAttribute('data-top') || draggedElement.getAttribute('data-left') ||
                      draggedElement.getAttribute('data-bottom') || draggedElement.getAttribute('data-right');
    
    if (!hasPosition) {
      showNotification(
        'This element has no position attributes (top/left/bottom/right). Please move the parent element instead.',
        'error'
      );
      
      if (draggedOverlay && draggedOverlay.style) {
        draggedOverlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
        draggedOverlay.style.background = 'rgba(255, 0, 0, 0.1)';
      }
      
      if (draggedElement && draggedElement.style) {
        draggedElement.style.opacity = '1';
        
        if (resizeStartRect) {
          draggedElement.style.top = `${resizeStartRect.top}%`;
          draggedElement.style.left = `${resizeStartRect.left}%`;
          draggedElement.style.width = `${resizeStartRect.width}%`;
          draggedElement.style.height = `${resizeStartRect.height}%`;
          
          if (draggedElement.tagName === 'IMG' && draggedOverlay) {
            draggedOverlay.style.top = `${resizeStartRect.top}%`;
            draggedOverlay.style.left = `${resizeStartRect.left}%`;
            draggedOverlay.style.width = `${resizeStartRect.width}%`;
            draggedOverlay.style.height = `${resizeStartRect.height}%`;
          }
        }
      }
      
      draggedElement = null;
      draggedOverlay = null;
      parentRect = null;
      parentElement = null;
      resizeHandle = null;
      resizeStartRect = null;
      resizeStartMouse = null;
      isResizing = false;
      return;
    }
    
    const unsupportedUnits = getUnsupportedUnits(draggedElement);
    if (unsupportedUnits.length > 0) {
      showNotification(
        `This element cannot be updated because it contains non-percentage units: ${unsupportedUnits.join(', ')}`,
        'error'
      );
      
      // Reset UI
      if (draggedOverlay && draggedOverlay.style) {
        draggedOverlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
        draggedOverlay.style.background = 'rgba(255, 0, 0, 0.1)';
      }
      
      if (draggedElement && draggedElement.style) {
        draggedElement.style.opacity = '1';
        
        // Restore original size
        draggedElement.style.top = `${resizeStartRect.top}%`;
        draggedElement.style.left = `${resizeStartRect.left}%`;
        draggedElement.style.width = `${resizeStartRect.width}%`;
        draggedElement.style.height = `${resizeStartRect.height}%`;
        
        if (draggedElement.tagName === 'IMG' && draggedOverlay) {
          draggedOverlay.style.top = `${resizeStartRect.top}%`;
          draggedOverlay.style.left = `${resizeStartRect.left}%`;
          draggedOverlay.style.width = `${resizeStartRect.width}%`;
          draggedOverlay.style.height = `${resizeStartRect.height}%`;
        }
      }
      
      draggedElement = null;
      draggedOverlay = null;
      parentRect = null;
      parentElement = null;
      resizeHandle = null;
      resizeStartRect = null;
      resizeStartMouse = null;
      isResizing = false;
      return;
    }
    
    const styleTop = draggedElement.style.top;
    const styleLeft = draggedElement.style.left;
    const styleWidth = draggedElement.style.width;
    const styleHeight = draggedElement.style.height;
    
    const finalTop = styleTop ? parseFloat(styleTop) : NaN;
    const finalLeft = styleLeft ? parseFloat(styleLeft) : NaN;
    const finalWidth = styleWidth ? parseFloat(styleWidth) : NaN;
    const finalHeight = styleHeight ? parseFloat(styleHeight) : NaN;
    
    // NaN check
    if (isNaN(finalTop) || isNaN(finalLeft) || isNaN(finalWidth) || isNaN(finalHeight)) {
      console.error('[Resize] Invalid size values:', { finalTop, finalLeft, finalWidth, finalHeight });
      showNotification('Error: Failed to calculate size', 'error');
      
      // Reset UI
      if (draggedOverlay && draggedOverlay.style) {
        draggedOverlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
        draggedOverlay.style.background = 'rgba(255, 0, 0, 0.1)';
      }
      
      if (draggedElement && draggedElement.style) {
        draggedElement.style.opacity = '1';
        
        // Restore original size
        if (resizeStartRect) {
          draggedElement.style.top = `${resizeStartRect.top}%`;
          draggedElement.style.left = `${resizeStartRect.left}%`;
          draggedElement.style.width = `${resizeStartRect.width}%`;
          draggedElement.style.height = `${resizeStartRect.height}%`;
          
          if (draggedElement.tagName === 'IMG' && draggedOverlay) {
            draggedOverlay.style.top = `${resizeStartRect.top}%`;
            draggedOverlay.style.left = `${resizeStartRect.left}%`;
            draggedOverlay.style.width = `${resizeStartRect.width}%`;
            draggedOverlay.style.height = `${resizeStartRect.height}%`;
          }
        }
      }
      
      draggedElement = null;
      draggedOverlay = null;
      parentRect = null;
      parentElement = null;
      resizeHandle = null;
      resizeStartRect = null;
      resizeStartMouse = null;
      isResizing = false;
      return;
    }
    
    const roundedTop = Math.round(finalTop * 10) / 10;
    const roundedLeft = Math.round(finalLeft * 10) / 10;
    const roundedWidth = Math.round(finalWidth * 10) / 10;
    const roundedHeight = Math.round(finalHeight * 10) / 10;
    
    // Calculate delta from resize start
    const deltaTop = Math.abs(roundedTop - resizeStartRect.top);
    const deltaLeft = Math.abs(roundedLeft - resizeStartRect.left);
    const deltaWidth = Math.abs(roundedWidth - resizeStartRect.width);
    const deltaHeight = Math.abs(roundedHeight - resizeStartRect.height);
    
    // Skip update if changes are below threshold
    if (deltaTop < DRAG_THRESHOLD && deltaLeft < DRAG_THRESHOLD && 
        deltaWidth < DRAG_THRESHOLD && deltaHeight < DRAG_THRESHOLD) {
      console.log(`[Drag Size] Changes too small - ignoring`);
      
      if (draggedOverlay && draggedOverlay.style) {
        draggedOverlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
        draggedOverlay.style.background = 'rgba(255, 0, 0, 0.1)';
      }
      
      if (draggedElement && draggedElement.style) {
        draggedElement.style.opacity = '1';
        
        draggedElement.style.top = `${resizeStartRect.top}%`;
        draggedElement.style.left = `${resizeStartRect.left}%`;
        draggedElement.style.width = `${resizeStartRect.width}%`;
        draggedElement.style.height = `${resizeStartRect.height}%`;
        
        if (draggedElement.tagName === 'IMG' && draggedOverlay) {
          draggedOverlay.style.top = `${resizeStartRect.top}%`;
          draggedOverlay.style.left = `${resizeStartRect.left}%`;
          draggedOverlay.style.width = `${resizeStartRect.width}%`;
          draggedOverlay.style.height = `${resizeStartRect.height}%`;
        }
      }
      
      draggedElement = null;
      draggedOverlay = null;
      parentRect = null;
      parentElement = null;
      resizeHandle = null;
      resizeStartRect = null;
      resizeStartMouse = null;
      isResizing = false;
      return;
    }
    
    draggedElement.dataset.updating = 'true';
    
    const mdIndex = parseInt(draggedElement.getAttribute('data-md-index') || '0', 10);
    const classList = Array.from(draggedElement.classList).filter(c => c !== 'absolute');
    
    const currentTop = draggedElement.getAttribute('data-top');
    const currentLeft = draggedElement.getAttribute('data-left');
    const currentWidth = draggedElement.getAttribute('data-width');
    const currentHeight = draggedElement.getAttribute('data-height');
    
    // Important: use values from resize start (guards against null data attributes)
    const oldTopNum = resizeStartRect.top;
    const oldLeftNum = resizeStartRect.left;
    const oldWidthNum = resizeStartRect.width;
    const oldHeightNum = resizeStartRect.height;
    const newTopValue = styleTop ? roundedTop : null;
    const newLeftValue = styleLeft ? roundedLeft : null;
    const newWidthValue = styleWidth ? roundedWidth : null;
    const newHeightValue = styleHeight ? roundedHeight : null;
    
    console.log(`[Resize] Saving to history - old: [${oldTopNum}, ${oldLeftNum}, ${oldWidthNum}, ${oldHeightNum}], new: [${newTopValue}, ${newLeftValue}, ${newWidthValue}, ${newHeightValue}]`);

    addToHistory({
      type: 'size',
      element: draggedElement,
      oldTop: resizeStartRect.hadTop ? oldTopNum : null,
      oldLeft: resizeStartRect.hadLeft ? oldLeftNum : null,
      oldBottom: resizeStartRect.hadBottom ? (100 - oldTopNum - oldHeightNum) : null,
      oldRight: resizeStartRect.hadRight ? (100 - oldLeftNum - oldWidthNum) : null,
      oldWidth: resizeStartRect.hadWidth ? oldWidthNum : null,
      oldHeight: resizeStartRect.hadHeight ? oldHeightNum : null,
      newTop: newTopValue,
      newLeft: newLeftValue,
      newWidth: newWidthValue,
      newHeight: newHeightValue
    });
    
    await sendSizeUpdate(mdIndex, roundedTop, roundedLeft, roundedWidth, roundedHeight, 
                        currentTop, currentLeft, currentWidth, currentHeight, classList, true);
    
    if (draggedOverlay && draggedOverlay.style) {
      draggedOverlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
      draggedOverlay.style.background = 'rgba(255, 0, 0, 0.1)';
    }
    
    if (draggedElement && draggedElement.style) {
      draggedElement.style.opacity = '1';
      
      // Always update data attributes (used in subsequent drag/resize operations)
      draggedElement.setAttribute('data-top', `${roundedTop}%`);
      draggedElement.setAttribute('data-left', `${roundedLeft}%`);
      draggedElement.setAttribute('data-width', `${roundedWidth}%`);
      draggedElement.setAttribute('data-height', `${roundedHeight}%`);
      
      console.log(`[Resize] Updated data attributes - top=${roundedTop}%, left=${roundedLeft}%, width=${roundedWidth}%, height=${roundedHeight}%`);
      
      delete draggedElement.dataset.updating;
    }
    
    draggedElement = null;
    draggedOverlay = null;
    parentRect = null;
    parentElement = null;
    resizeHandle = null;
    resizeStartRect = null;
    resizeStartMouse = null;
    isResizing = false;
  }

  // Toggle overlay visibility and enable/disable pointer events
  function updateOverlayVisibility() {
    const allOverlays = document.querySelectorAll('.quarto-drag-overlay');
    
    allOverlays.forEach(overlay => {
      const targetIndex = overlay.getAttribute('data-target-index');
      const overlayElement = document.querySelector(`[data-html-index="${targetIndex}"]`);
      
      if (!overlayElement) {
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
        return;
      }
      
      const slide = overlayElement.closest('section.slide');
      
      if (slide) {
        // Element inside a slide
        const isCurrentSlide = slide.classList.contains('present');
        
        if (editMode && isCurrentSlide) {
          // Edit mode ON for current slide → show and enable
          overlay.style.display = '';
          overlay.style.pointerEvents = 'auto';
        } else {
          // Otherwise → hide and disable
          overlay.style.display = 'none';
          overlay.style.pointerEvents = 'none';
        }
      } else {
        // Element outside a slide
        if (editMode) {
          overlay.style.display = '';
          overlay.style.pointerEvents = 'auto';
        } else {
          overlay.style.display = 'none';
          overlay.style.pointerEvents = 'none';
        }
      }
    });
  }

  // Standalone function to recalculate overlay position and size for image elements
  function recalculateImageOverlay(imgElement) {
    const overlay = document.querySelector(`[data-target-index="${imgElement.getAttribute('data-html-index')}"]`);
    if (!overlay) return;
    
    // Get parent element
    let positionParent = imgElement.offsetParent;
    if (!positionParent) {
      let parent = imgElement.parentElement;
      while (parent && parent !== document.body) {
        if (parent.hasAttribute('data-draggable') && parent.classList.contains('absolute')) {
          positionParent = parent;
          break;
        }
        parent = parent.parentElement;
      }
      if (!positionParent) {
        positionParent = imgElement.closest('section.slide');
      }
      if (!positionParent) return;
    }
    
    const imgRect = imgElement.getBoundingClientRect();
    const parentRect = positionParent.getBoundingClientRect();
    
    if (imgRect.width < 1 || imgRect.height < 1) return;
    
    const computedStyle = window.getComputedStyle(imgElement);
    const marginTop = parseFloat(computedStyle.marginTop) || 0;
    const marginLeft = parseFloat(computedStyle.marginLeft) || 0;
    const marginBottom = parseFloat(computedStyle.marginBottom) || 0;
    const marginRight = parseFloat(computedStyle.marginRight) || 0;
    
    const actualTopPercent = ((imgRect.top - parentRect.top) / parentRect.height) * 100;
    const actualLeftPercent = ((imgRect.left - parentRect.left) / parentRect.width) * 100;
    
    const topAdjustPercent = (marginTop / parentRect.height) * 100;
    const leftAdjustPercent = (marginLeft / parentRect.width) * 100;
    
    const widthWithMarginPercent = ((imgRect.width + marginLeft + marginRight) / parentRect.width) * 100;
    const heightWithMarginPercent = ((imgRect.height + marginTop + marginBottom) / parentRect.height) * 100;
    
    const finalTop = actualTopPercent - topAdjustPercent;
    const finalLeft = actualLeftPercent - leftAdjustPercent;
    
    overlay.style.top = `${finalTop}%`;
    overlay.style.left = `${finalLeft}%`;
    overlay.style.width = `${widthWithMarginPercent}%`;
    overlay.style.height = `${heightWithMarginPercent}%`;
  }

  function init() {
    log('[Move Abs Elems] Initializing...');
    
    const draggableElements = document.querySelectorAll('[data-draggable="true"]');
    log(`[Move Abs Elems] Found ${draggableElements.length} draggable elements`);
    
    // Sort by depth (shallow to deep)
    const sortedElements = Array.from(draggableElements).sort((a, b) => {
      return getDepth(a) - getDepth(b);
    });
    
    sortedElements.forEach((element, index) => {
      if (!element.hasAttribute('data-draggable')) {
        return;
      }
      
      element.setAttribute('data-html-index', String(index));

      // Initialize data attributes (only for values explicitly set in style)
      const styleTop = element.style.top || '';
      const styleLeft = element.style.left || '';
      const styleBottom = element.style.bottom || '';
      const styleRight = element.style.right || '';
      const styleWidth = element.style.width || '';
      const styleHeight = element.style.height || '';

      // Warning if no position attributes are set (commented out)
      // if (!styleTop && !styleLeft && !styleBottom && !styleRight) {
      //   console.error(`[Init] Element ${index} has no position (top/left/bottom/right). Please add position attributes.`);
      //   showNotification(`Element #${element.id || index} has no position. Please set one of: top/left/bottom/right.`, 'error');
      // }

      // Set data attributes only if not already set (only for values explicitly set in style)
      if (styleTop && !element.getAttribute('data-top')) {
        element.setAttribute('data-top', styleTop);
      }
      if (styleLeft && !element.getAttribute('data-left')) {
        element.setAttribute('data-left', styleLeft);
      }
      if (styleBottom && !element.getAttribute('data-bottom')) {
        element.setAttribute('data-bottom', styleBottom);
      }
      if (styleRight && !element.getAttribute('data-right')) {
        element.setAttribute('data-right', styleRight);
      }
      if (styleWidth && !element.getAttribute('data-width')) {
        element.setAttribute('data-width', styleWidth);
      }
      if (styleHeight && !element.getAttribute('data-height')) {
        element.setAttribute('data-height', styleHeight);
      }

      log(`[Init] Element ${index} - set data attributes: top=${element.getAttribute('data-top')}, left=${element.getAttribute('data-left')}, bottom=${element.getAttribute('data-bottom')}, right=${element.getAttribute('data-right')}, width=${element.getAttribute('data-width')}, height=${element.getAttribute('data-height')}`);

      const computedStyle = window.getComputedStyle(element);
      const hasPointerEventsNone = computedStyle.pointerEvents === 'none';
      
      if (hasPointerEventsNone) {
        element.setAttribute('data-original-pointer-events', 'none');
      }
      
      const overlay = document.createElement('div');
      overlay.className = 'quarto-drag-overlay';
      
      let depth = getDraggableDepth(element);
      // z-index calculation: deeper elements get higher z-index
      const baseZIndex = 999000;
      const depthMultiplier = 1000; // increment by 1000 per depth level
      const zIndex = baseZIndex + (depth * depthMultiplier) + index;
      
      log(`[Move Abs Elems] Element ${index} (${element.tagName}#${element.id}) depth: ${depth}, z-index: ${zIndex}`);
      
      if (element.tagName === 'IMG') {
        const immediateParent = element.parentElement;
        if (!immediateParent) {
          return;
        }
        
        let positionParent = element.offsetParent;
        
        if (!positionParent) {
          let parent = element.parentElement;
          while (parent && parent !== document.body) {
            if (parent.hasAttribute('data-draggable') && parent.classList.contains('absolute')) {
              positionParent = parent;
              break;
            }
            parent = parent.parentElement;
          }
          
          if (!positionParent) {
            positionParent = element.closest('section.slide');
          }
          
          if (!positionParent) {
            return;
          }
        }
        
        const existingOverlay = positionParent.querySelector(`[data-target-index="${index}"]`);
        if (existingOverlay) {
          return;
        }
        
        const updateOverlayTransform = () => {
          const imgRect = element.getBoundingClientRect();
          const parentRect = positionParent.getBoundingClientRect();
          
          if (imgRect.width < 1 || imgRect.height < 1) {
            return false;
          }
          
          const computedStyle = window.getComputedStyle(element);
          const marginTop = parseFloat(computedStyle.marginTop) || 0;
          const marginLeft = parseFloat(computedStyle.marginLeft) || 0;
          const marginBottom = parseFloat(computedStyle.marginBottom) || 0;
          const marginRight = parseFloat(computedStyle.marginRight) || 0;
          
          // Calculate actual image position from getBoundingClientRect
          const actualTopPercent = ((imgRect.top - parentRect.top) / parentRect.height) * 100;
          const actualLeftPercent = ((imgRect.left - parentRect.left) / parentRect.width) * 100;
          
          // Adjust position by margin amount
          const topAdjustPercent = (marginTop / parentRect.height) * 100;
          const leftAdjustPercent = (marginLeft / parentRect.width) * 100;
          
          // Include margins in size calculation
          const widthWithMarginPercent = ((imgRect.width + marginLeft + marginRight) / parentRect.width) * 100;
          const heightWithMarginPercent = ((imgRect.height + marginTop + marginBottom) / parentRect.height) * 100;
          
          // Subtract margin from actual display position
          const finalTop = actualTopPercent - topAdjustPercent;
          const finalLeft = actualLeftPercent - leftAdjustPercent;
          
          overlay.style.top = `${finalTop}%`;
          overlay.style.left = `${finalLeft}%`;
          overlay.style.width = `${widthWithMarginPercent}%`;
          overlay.style.height = `${heightWithMarginPercent}%`;
          
          return true;
        };
        
        const imgTop = element.style.top || element.getAttribute('data-top') || '0%';
        const imgLeft = element.style.left || element.getAttribute('data-left') || '0%';
        
        overlay.style.cssText = `
          position: absolute !important;
          top: ${imgTop} !important;
          left: ${imgLeft} !important;
          width: 10% !important;
          height: 10% !important;
          pointer-events: auto !important;
          z-index: ${zIndex} !important;
          background: rgba(255, 0, 0, 0.1) !important;
          border: 1px dashed rgba(0, 123, 255, 0.3) !important;
          transition: border 0.2s, background 0.2s !important;
          cursor: move !important;
          box-sizing: border-box !important;
        `;
        
        positionParent.appendChild(overlay);
        
        // Use recalculateImageOverlay directly
        setTimeout(() => recalculateImageOverlay(element), 100);
        setTimeout(() => recalculateImageOverlay(element), 500);
        setTimeout(() => recalculateImageOverlay(element), 1000);
        
        if (!element.complete) {
          element.addEventListener('load', () => recalculateImageOverlay(element));
        }
        
        let currentSlide = element.closest('section.slide');
        if (currentSlide) {
          const checkSlideVisibility = () => {
            const isCurrentSlide = currentSlide.classList.contains('present');
            if (isCurrentSlide) {
              overlay.style.display = editMode ? '' : 'none';
              setTimeout(() => recalculateImageOverlay(element), 100);
            } else {
              overlay.style.display = 'none';
            }
          };
          
          checkSlideVisibility();
          
          const observer = new MutationObserver(() => checkSlideVisibility());
          observer.observe(currentSlide, {
            attributes: true,
            attributeFilter: ['class']
          });
        }
      } else {
        // Standard elements (DIV, etc.)
        
        // Check for existing overlay
        const existingOverlay = element.querySelector(`[data-target-index="${index}"]`);
        if (existingOverlay) {
          log(`[Move Abs Elems] Overlay already exists for element ${index}, skipping creation`);
          // Re-attach event listeners to existing overlay
          makeDraggableWithOverlay(element, existingOverlay);
          
          existingOverlay.addEventListener('click', (e) => {
            e.stopPropagation();
          });
          
          // Show/hide based on edit mode state
          if (editMode) {
            const slide = element.closest('section.slide');
            if (slide) {
              if (slide.classList.contains('present')) {
                existingOverlay.style.display = '';
              } else {
                existingOverlay.style.display = 'none';
              }
            } else {
              existingOverlay.style.display = '';
            }
          } else {
            existingOverlay.style.display = 'none';
          }
          
          return;
        }
        
        overlay.style.cssText = `
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          pointer-events: auto !important;
          z-index: ${zIndex} !important;
          background: rgba(255, 0, 0, 0.1) !important;
          border: 1px dashed rgba(0, 123, 255, 0.3) !important;
          transition: border 0.2s, background 0.2s !important;
          cursor: move !important;
          box-sizing: border-box !important;
        `;
        
        const elementStyle = window.getComputedStyle(element);
        if (elementStyle.position === 'static') {
          element.style.position = 'relative';
        }
        
        // Insert overlay as the first child (before other children)
        if (element.firstChild) {
          element.insertBefore(overlay, element.firstChild);
        } else {
          element.appendChild(overlay);
        }
      }
      
      overlay.setAttribute('data-drag-overlay', 'true');
      overlay.setAttribute('data-target-index', String(index));
      overlay.setAttribute('data-overlay-depth', String(depth));
      
      // Add resize handles
      createResizeHandles(overlay, element);
      
      const enableOverlay = () => {
        setActiveOverlay(overlay, element);
      };
      
      const disableOverlay = () => {
        if (currentActiveOverlay === overlay) {
          clearActiveOverlay();
        }
      };
      
      overlay.addEventListener('mouseenter', (e) => {
        enableOverlay();
        e.stopPropagation();
      });
      
      overlay.addEventListener('mousemove', (e) => {
        // Skip while dragging or resizing
        if (isDragging || isResizing) {
          return;
        }
        
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        
        // Temporarily make this overlay transparent to check element below
        overlay.style.pointerEvents = 'none';
        let elementBelow = document.elementFromPoint(mouseX, mouseY);
        overlay.style.pointerEvents = 'auto';
        
        // If elementBelow is a descendant draggable element, find its overlay
        if (elementBelow && elementBelow.hasAttribute('data-draggable')) {
          const childOverlay = elementBelow.querySelector('.quarto-drag-overlay');
          if (childOverlay) {
            elementBelow = childOverlay;
          }
        } else if (elementBelow && !elementBelow.classList.contains('quarto-drag-overlay')) {
          // If not an overlay, find the nearest draggable ancestor
          let current = elementBelow;
          while (current && current !== document.body) {
            if (current.hasAttribute('data-draggable')) {
              const childOverlay = current.querySelector('.quarto-drag-overlay');
              if (childOverlay) {
                elementBelow = childOverlay;
                break;
              }
            }
            current = current.parentElement;
          }
        }
        
        // If hovering over a child overlay, activate the child
        if (elementBelow && elementBelow.classList.contains('quarto-drag-overlay') && elementBelow !== overlay) {
          const childIndex = parseInt(elementBelow.getAttribute('data-target-index') || '-1');
          const childDepth = parseInt(elementBelow.getAttribute('data-overlay-depth') || '0');
          const currentDepth = parseInt(overlay.getAttribute('data-overlay-depth') || '0');
          
          // Only switch if child is deeper
          if (childDepth > currentDepth && childIndex !== index) {
            console.log(`[Move Abs Elems] Switching from overlay ${index} (depth ${currentDepth}) to overlay ${childIndex} (depth ${childDepth})`);
            const childElement = document.querySelector(`[data-html-index="${childIndex}"]`);
            setActiveOverlay(elementBelow, childElement);
            return;
          }
        }
        
        // If not over a child, activate this overlay
        const currentBorder = overlay.style.border;
        if (!currentBorder.includes('0.7')) {
          enableOverlay();
        }
      });
      
      overlay.addEventListener('mouseleave', (e) => {
        e.stopPropagation();
        clearActiveOverlay();
      });
      
      overlay.addEventListener('mousedown', (e) => {
        // Let resize handles handle their own events
        if (e.target.classList.contains('resize-handle')) {
          return;
        }
        
        // Skip while dragging or resizing
        if (isDragging || isResizing) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        
        const clickX = e.clientX;
        const clickY = e.clientY;
        
        // Temporarily make this overlay transparent to get element below
        overlay.style.pointerEvents = 'none';
        let elementBelow = document.elementFromPoint(clickX, clickY);
        overlay.style.pointerEvents = 'auto';
        
        // If elementBelow is a descendant draggable element, find its overlay
        if (elementBelow && elementBelow.hasAttribute('data-draggable')) {
          const childOverlay = elementBelow.querySelector('.quarto-drag-overlay');
          if (childOverlay) {
            elementBelow = childOverlay;
          }
        } else if (elementBelow && !elementBelow.classList.contains('quarto-drag-overlay')) {
          // If not an overlay, find the nearest draggable ancestor
          let current = elementBelow;
          while (current && current !== document.body) {
            if (current.hasAttribute('data-draggable')) {
              const childOverlay = current.querySelector('.quarto-drag-overlay');
              if (childOverlay) {
                elementBelow = childOverlay;
                break;
              }
            }
            current = current.parentElement;
          }
        }
        
        // If element below is a child overlay, delegate the event to it
        if (elementBelow && elementBelow.classList.contains('quarto-drag-overlay')) {
          const childIndex = parseInt(elementBelow.getAttribute('data-target-index'));
          const childDepth = parseInt(elementBelow.getAttribute('data-overlay-depth') || '0');
          const currentDepth = parseInt(overlay.getAttribute('data-overlay-depth') || '0');
          
          // Only delegate if child is deeper
          if (!isNaN(childIndex) && childDepth > currentDepth && childIndex !== index) {
            console.log(`[Move Abs Elems] Delegating mousedown from overlay ${index} to overlay ${childIndex}`);
            const mousedownEvent = new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              clientX: clickX,
              clientY: clickY,
              button: e.button
            });
            elementBelow.dispatchEvent(mousedownEvent);
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        
        // Proceed with normal mousedown handling
      });
      
      makeDraggableWithOverlay(element, overlay);
      
      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    });
    
    testServerConnection();
    
    // Listen for Reveal slide change events
    if (window.Reveal) {
      window.Reveal.on('slidechanged', (event) => {
        log('[Move Abs Elems] Slide changed, updating overlay visibility...');
        updateOverlayVisibility();
      });
    }
    
    // Set initial state
    updateOverlayVisibility();
    
    // Enable edit mode by default
    if (editMode) {
      // Create and show the Undo/Redo panel
      if (!undoRedoPanel) {
        createUndoRedoPanel();
      }
      undoRedoPanel.style.display = 'block';
      updateHistoryInfo();
      
      // Show all overlays
      const allOverlays = document.querySelectorAll('.quarto-drag-overlay');
      allOverlays.forEach(overlay => {
        const overlayElement = document.querySelector(`[data-html-index="${overlay.getAttribute('data-target-index')}"]`);
        if (overlayElement) {
          const slide = overlayElement.closest('section.slide');
          if (slide) {
            // Elements inside slides: show only for the currently visible slide
            if (slide.classList.contains('present')) {
              overlay.style.display = '';
            }
          } else {
            // Elements outside slides: always show
            overlay.style.display = '';
          }
        } else {
          overlay.style.display = '';
        }
      });
      
      log('[Move Abs Elems] Initial state: Edit mode ON');
    } else {
      const allOverlays = document.querySelectorAll('.quarto-drag-overlay');
      allOverlays.forEach(overlay => {
        overlay.style.display = 'none';
      });
      log('[Move Abs Elems] Initial state: Edit mode OFF');
    }
  }
  function getDepth(element) {
    let depth = 0;
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      depth++;
      parent = parent.parentElement;
    }
    return depth;
  }

  function getDraggableDepth(element) {
    let depth = 0;
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      if (parent.hasAttribute('data-draggable')) {
        depth++;
      }
      parent = parent.parentElement;
    }
    return depth;
  }

  async function testServerConnection() {
    try {
      const response = await fetch(`${VSCODE_SERVER_URL}/health`);
      if (response.ok) {
        log('[Move Abs Elems] VSCode server is connected');
      }
    } catch (error) {
      console.warn('[Move Abs Elems] VSCode server is not running.');
    }
  }

  function makeDraggableWithOverlay(element, overlay) {
    overlay.addEventListener('mousedown', (e) => {
      // Let resize handles handle their own events
      if (e.target.classList.contains('resize-handle')) {
        return;
      }
      onMouseDownWithOverlay(e, element, overlay);
    });
  }

  function onMouseDownWithOverlay(e, targetElement, overlay) {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedElement || isResizing) {
      return;
    }
    
    // Start dragging
    isDragging = true;
    draggedElement = targetElement;
    draggedOverlay = overlay;
    
    overlay.style.border = '1px solid rgba(0, 123, 255, 1)';
    overlay.style.background = 'rgba(0, 123, 255, 0.1)';
    
    if (draggedElement.tagName === 'IMG') {
      parentElement = overlay.parentElement;
    } else {
      parentElement = draggedElement.parentElement;
      
      while (parentElement && parentElement !== document.body) {
        if (parentElement.hasAttribute('data-draggable')) {
          break;
        }
        parentElement = parentElement.parentElement;
      }
      
      if (!parentElement || parentElement === document.body) {
        parentElement = draggedElement.offsetParent || document.body;
      }
    }
    
    parentRect = parentElement.getBoundingClientRect();
    
    // Get current position from data attributes (accurate values after resize)
    const dataTop = draggedElement.getAttribute('data-top');
    const dataLeft = draggedElement.getAttribute('data-left');
    
    let elementTopPercent, elementLeftPercent;
    
    if (dataTop && dataLeft) {
      // Use data attributes if available
      elementTopPercent = parseFloat(dataTop.replace('%', ''));
      elementLeftPercent = parseFloat(dataLeft.replace('%', ''));
      console.log(`[Drag Start] Using data attributes - top=${elementTopPercent}%, left=${elementLeftPercent}%`);
    } else {
      // Fall back to computed position
      const rect = draggedElement.getBoundingClientRect();
      elementTopPercent = ((rect.top - parentRect.top) / parentRect.height) * 100;
      elementLeftPercent = ((rect.left - parentRect.left) / parentRect.width) * 100;
      console.log(`[Drag Start] Calculated from rect - top=${elementTopPercent}%, left=${elementLeftPercent}%`);
    }
    
    const clickTopPercent = ((e.clientY - parentRect.top) / parentRect.height) * 100;
    const clickLeftPercent = ((e.clientX - parentRect.left) / parentRect.width) * 100;
    
    offsetX = clickLeftPercent - elementLeftPercent;
    offsetY = clickTopPercent - elementTopPercent;
    
    // Record drag start position (using data attribute values)
    dragStartPos = {
      top: elementTopPercent,
      left: elementLeftPercent
    };
    
    console.log(`[Drag Start] dragStartPos set to - top=${dragStartPos.top}%, left=${dragStartPos.left}%`);
    
    draggedElement.style.opacity = '0.8';
    draggedElement.style.zIndex = '999999';
    
    document.addEventListener('mousemove', onMouseMove);
    
    if (currentMouseUpHandler) {
      document.removeEventListener('mouseup', currentMouseUpHandler);
    }
    
    currentMouseUpHandler = (e) => onMouseUpWithOverlay(e, overlay);
    document.addEventListener('mouseup', currentMouseUpHandler);
  }

  // Check whether a value uses percentage units
  function isPercentageUnit(value) {
    if (!value) return true; // null or undefined is acceptable
    const str = String(value).trim();
    return str === '' || str.endsWith('%');
  }

  function getUnsupportedUnits(element) {
    const unsupportedUnits = [];
    
    const top = element.getAttribute('data-top');
    const left = element.getAttribute('data-left');
    const width = element.getAttribute('data-width');
    const height = element.getAttribute('data-height');
    const bottom = element.getAttribute('data-bottom');
    const right = element.getAttribute('data-right');
    
    if (top && !isPercentageUnit(top)) unsupportedUnits.push(`top="${top}"`);
    if (left && !isPercentageUnit(left)) unsupportedUnits.push(`left="${left}"`);
    if (width && !isPercentageUnit(width)) unsupportedUnits.push(`width="${width}"`);
    if (height && !isPercentageUnit(height)) unsupportedUnits.push(`height="${height}"`);
    if (bottom && !isPercentageUnit(bottom)) unsupportedUnits.push(`bottom="${bottom}"`);
    if (right && !isPercentageUnit(right)) unsupportedUnits.push(`right="${right}"`);
    
    return unsupportedUnits;
  }

  async function onMouseUpWithOverlay(e, overlay) {
    document.removeEventListener('mousemove', onMouseMove);
    if (currentMouseUpHandler) {
      document.removeEventListener('mouseup', currentMouseUpHandler);
      currentMouseUpHandler = null;
    }
    
    if (!draggedElement || !parentRect) {
      isDragging = false;
      dragStartPos = null;
      return;
    }
    
    if (draggedElement.dataset.updating === 'true') {
      isDragging = false;
      dragStartPos = null;
      return;
    }
    
    // Check for position attributes
    const hasPosition = draggedElement.style.top || draggedElement.style.left || 
                      draggedElement.style.bottom || draggedElement.style.right ||
                      draggedElement.getAttribute('data-top') || draggedElement.getAttribute('data-left') ||
                      draggedElement.getAttribute('data-bottom') || draggedElement.getAttribute('data-right');
    
    if (!hasPosition) {
      showNotification(
        'This element has no position attributes (top/left/bottom/right). Please move the parent element instead.',
        'error'
      );
      
      if (overlay && overlay.style) {
        overlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
        overlay.style.background = 'rgba(255, 0, 0, 0.1)';
      }
      
      if (draggedElement && draggedElement.style) {
        draggedElement.style.opacity = '1';
        draggedElement.style.zIndex = '';
        
        if (dragStartPos) {
          draggedElement.style.top = `${dragStartPos.top}%`;
          draggedElement.style.left = `${dragStartPos.left}%`;
          
          if (draggedElement.tagName === 'IMG' && overlay) {
            overlay.style.top = `${dragStartPos.top}%`;
            overlay.style.left = `${dragStartPos.left}%`;
          }
        }
      }
      
      draggedElement = null;
      draggedOverlay = null;
      parentRect = null;
      parentElement = null;
      isDragging = false;
      dragStartPos = null;
      return;
    }
    
    const unsupportedUnits = getUnsupportedUnits(draggedElement);
    if (unsupportedUnits.length > 0) {
      showNotification(
        `This element cannot be updated because it contains non-percentage units: ${unsupportedUnits.join(', ')}`,
        'error'
      );
      
      // Reset UI
      if (overlay && overlay.style) {
        overlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
        overlay.style.background = 'rgba(255, 0, 0, 0.1)';
      }
      
      if (draggedElement && draggedElement.style) {
        draggedElement.style.opacity = '1';
        draggedElement.style.zIndex = '';
        
        // Restore original position
        draggedElement.style.top = `${dragStartPos.top}%`;
        draggedElement.style.left = `${dragStartPos.left}%`;
        
        // Restore overlay position for IMG elements
        if (draggedElement.tagName === 'IMG' && overlay) {
          overlay.style.top = `${dragStartPos.top}%`;
          overlay.style.left = `${dragStartPos.left}%`;
        }
      }
      
      draggedElement = null;
      draggedOverlay = null;
      parentRect = null;
      parentElement = null;
      isDragging = false;
      dragStartPos = null;
      return;
    }
    
    const styleTop = draggedElement.style.top;
    const styleLeft = draggedElement.style.left;
    
    const finalTop = parseFloat(styleTop);
    const finalLeft = parseFloat(styleLeft);
    
    const roundedLeft = Math.round(finalLeft * 10) / 10;
    const roundedTop = Math.round(finalTop * 10) / 10;
    
    // Compare drag start position with current position
    const deltaTop = Math.abs(roundedTop - dragStartPos.top);
    const deltaLeft = Math.abs(roundedLeft - dragStartPos.left);
    
    // Skip update if movement is below threshold
    if (deltaTop < DRAG_THRESHOLD && deltaLeft < DRAG_THRESHOLD) {
      console.log(`[Move Abs Elems] Movement too small (${deltaTop.toFixed(2)}%, ${deltaLeft.toFixed(2)}%) - ignoring`);
      
      // Reset UI
      if (overlay && overlay.style) {
        overlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
        overlay.style.background = 'rgba(255, 0, 0, 0.1)';
      }
      
      if (draggedElement && draggedElement.style) {
        draggedElement.style.opacity = '1';
        draggedElement.style.zIndex = '';
        
        // Restore original position
        draggedElement.style.top = `${dragStartPos.top}%`;
        draggedElement.style.left = `${dragStartPos.left}%`;
        
        // Restore overlay position for IMG elements
        if (draggedElement.tagName === 'IMG' && overlay) {
          overlay.style.top = `${dragStartPos.top}%`;
          overlay.style.left = `${dragStartPos.left}%`;
        }
      }
      
      draggedElement = null;
      draggedOverlay = null;
      parentRect = null;
      parentElement = null;
      isDragging = false;
      dragStartPos = null;
      return;
    }
    
    draggedElement.dataset.updating = 'true';
    
    const mdIndex = parseInt(draggedElement.getAttribute('data-md-index') || '0', 10);
    
    const classList = Array.from(draggedElement.classList).filter(c => c !== 'absolute');
    const currentTop = draggedElement.getAttribute('data-top');
    const currentLeft = draggedElement.getAttribute('data-left');
    
    // Get original values from data attributes (strip % and parse as number)
    const oldTopNum = currentTop ? parseFloat(currentTop.replace('%', '')) : 0;
    const oldLeftNum = currentLeft ? parseFloat(currentLeft.replace('%', '')) : 0;
    
    // Add to history
    addToHistory({
      type: 'position',
      element: draggedElement,
      oldTop: oldTopNum,
      oldLeft: oldLeftNum,
      newTop: roundedTop,
      newLeft: roundedLeft
    });
    
    await sendPositionUpdate(mdIndex, roundedTop, roundedLeft, currentTop, currentLeft, classList, true);
    
    if (overlay && overlay.style) {
      overlay.style.border = '1px dashed rgba(0, 123, 255, 0.3)';
      overlay.style.background = 'rgba(255, 0, 0, 0.1)';
    }
    
    if (draggedElement && draggedElement.style) {
      draggedElement.style.opacity = '1';
      draggedElement.style.zIndex = '';
      
      draggedElement.setAttribute('data-top', `${roundedTop}%`);
      draggedElement.setAttribute('data-left', `${roundedLeft}%`);
      
      delete draggedElement.dataset.updating;
    }
    
    // End drag (after all cleanup)
    draggedElement = null;
    draggedOverlay = null;
    parentRect = null;
    parentElement = null;
    isDragging = false;
    dragStartPos = null;
  }

  function onMouseMove(e) {
    if (!draggedElement || !parentRect) return;
    
    const mouseTopPercent = ((e.clientY - parentRect.top) / parentRect.height) * 100;
    const mouseLeftPercent = ((e.clientX - parentRect.left) / parentRect.width) * 100;
    
    const newTop = mouseTopPercent - offsetY;
    const newLeft = mouseLeftPercent - offsetX;
    
    draggedElement.style.left = `${newLeft}%`;
    draggedElement.style.top = `${newTop}%`;
    
    if (draggedOverlay && draggedElement.tagName === 'IMG') {
      draggedOverlay.style.left = `${newLeft}%`;
      draggedOverlay.style.top = `${newTop}%`;
    }
  }

  async function sendPositionUpdate(mdIndex, top, left, currentTop, currentLeft, classList, addToHistoryFlag = true) {
    const fileName = getQmdFileName();
    
    if (!fileName) {
      showNotification('Error: Could not retrieve the qmd filename', 'error');
      return false;
    }
    
    // Strip % and extract numeric values only
    // Keep as null if not set (treated as default value on the VSCode side)
    let cleanCurrentTop = null;
    let cleanCurrentLeft = null;
    
    if (currentTop) {
      cleanCurrentTop = currentTop.replace('%', '');
    }
    if (currentLeft) {
      cleanCurrentLeft = currentLeft.replace('%', '');
    }
    
    const currentBottom = draggedElement ? draggedElement.getAttribute('data-bottom') : null;
    const currentRight = draggedElement ? draggedElement.getAttribute('data-right') : null;
    let cleanCurrentBottom = null;
    let cleanCurrentRight = null;
    
    if (currentBottom) {
      cleanCurrentBottom = currentBottom.replace('%', '');
    }
    if (currentRight) {
      cleanCurrentRight = currentRight.replace('%', '');
    }
    
    console.log(`[sendPositionUpdate] Sending: top=${top}, left=${left}, currentTop=${cleanCurrentTop}, currentLeft=${cleanCurrentLeft}, classList=${classList}`);
    
    try {
      const response = await fetch(`${VSCODE_SERVER_URL}/update-position`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: fileName,
          mdIndex: mdIndex,
          top: top,
          left: left,
          currentTop: cleanCurrentTop,
          currentLeft: cleanCurrentLeft,
          currentBottom: cleanCurrentBottom,
          currentRight: cleanCurrentRight,
          classList: classList
        })
      });
      
      if (response.ok) {
        if (addToHistoryFlag) {
          showNotification(`Position updated (MD Index: ${mdIndex})`, 'success');
        }
        return true;
      } else {
        const error = await response.json();
        
        if (error.error && error.error.includes('not found')) {
          showNotification('Update failed. Please reload the page (F5).', 'error');
        } else {
          showNotification(`Update failed: ${error.error}`, 'error');
        }
        return false;
      }
    } catch (error) {
      showNotification('Cannot connect to VSCode extension.', 'error');
      return false;
    }
  }

  async function sendSizeUpdate(mdIndex, top, left, width, height, currentTop, currentLeft, currentWidth, currentHeight, classList, addToHistoryFlag = true) {
    const fileName = getQmdFileName();
    
    if (!fileName) {
      showNotification('Error: Could not retrieve the qmd filename', 'error');
      return false;
    }
    
    // Strip % and extract numeric values only
    let cleanCurrentTop = null;
    let cleanCurrentLeft = null;
    let cleanCurrentWidth = null;
    let cleanCurrentHeight = null;
    
    if (currentTop) {
      cleanCurrentTop = currentTop.replace('%', '');
    }
    if (currentLeft) {
      cleanCurrentLeft = currentLeft.replace('%', '');
    }
    if (currentWidth) {
      cleanCurrentWidth = currentWidth.replace('%', '');
    }
    if (currentHeight) {
      cleanCurrentHeight = currentHeight.replace('%', '');
    }
    
    const currentBottom = draggedElement ? draggedElement.getAttribute('data-bottom') : null;
    const currentRight = draggedElement ? draggedElement.getAttribute('data-right') : null;
    let cleanCurrentBottom = null;
    let cleanCurrentRight = null;
    
    if (currentBottom) {
      cleanCurrentBottom = currentBottom.replace('%', '');
    }
    if (currentRight) {
      cleanCurrentRight = currentRight.replace('%', '');
    }
    
    try {
      const response = await fetch(`${VSCODE_SERVER_URL}/update-size`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: fileName,
          mdIndex: mdIndex,
          top: top,
          left: left,
          width: width,
          height: height,
          currentTop: cleanCurrentTop,
          currentLeft: cleanCurrentLeft,
          currentWidth: cleanCurrentWidth,
          currentHeight: cleanCurrentHeight,
          currentBottom: cleanCurrentBottom,
          currentRight: cleanCurrentRight,
          classList: classList
        })
      });
      
      if (response.ok) {
        if (addToHistoryFlag) {
          showNotification(`Size updated (MD Index: ${mdIndex})`, 'success');
        }
        return true;
      } else {
        const error = await response.json();
        
        if (error.error && error.error.includes('not found')) {
          showNotification('Update failed. Please reload the page (F5).', 'error');
        } else {
          showNotification(`Update failed: ${error.error}`, 'error');
        }
        return false;
      }
    } catch (error) {
      showNotification('Cannot connect to VSCode extension.', 'error');
      return false;
    }
  }

  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      background: ${type === 'error' ? '#dc3545' : '#28a745'};
      color: white;
      border-radius: 5px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      z-index: 10000;
      font-family: sans-serif;
      font-size: 14px;
      max-width: 300px;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.transition = 'opacity 0.5s';
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 500);
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Keyboard shortcuts (Ctrl+Z / Ctrl+Y / Ctrl+Shift+E)
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+E (Windows/Linux) or Cmd+Shift+E (Mac) to toggle edit mode
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      toggleEditMode();
    }
    // Ctrl+Z (Windows/Linux) or Cmd+Z (Mac)
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && editMode) {
      e.preventDefault();
      undo();
    }
    // Ctrl+Y (Windows/Linux) or Cmd+Shift+Z (Mac)
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z')) && editMode) {
      e.preventDefault();
      redo();
    }
  });
})();