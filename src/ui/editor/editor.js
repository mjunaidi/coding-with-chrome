/**
 * @fileoverview Code Editor for the Coding with Chrome editor.
 *
 * @license Copyright 2015 The Coding with Chrome Authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author mbordihn@google.com (Markus Bordihn)
 */
goog.provide('cwc.ui.Editor');

goog.require('cwc.file.ContentType');
goog.require('cwc.soy.ui.Editor');
goog.require('cwc.ui.EditorFlags');
goog.require('cwc.ui.EditorHint');
goog.require('cwc.ui.EditorToolbar');
goog.require('cwc.ui.EditorType');
goog.require('cwc.ui.EditorView');
goog.require('cwc.ui.Helper');
goog.require('cwc.utils.Helper');

goog.require('goog.async.Throttle');
goog.require('goog.array');
goog.require('goog.dom');
goog.require('goog.dom.TagName');
goog.require('goog.dom.ViewportSizeMonitor');
goog.require('goog.events.EventTarget');
goog.require('goog.soy');
goog.require('goog.ui.Component.EventType');



/**
 * Customizable Code Editor.
 * @param {!cwc.utils.Helper} helper
 * @constructor
 * @struct
 * @final
 */
cwc.ui.Editor = function(helper) {
  /** @type {CodeMirror} */
  this.editor = null;

  /** @type {string} */
  this.name = 'Editor';

  /** @type {!cwc.utils.Helper} */
  this.helper = helper;

  /** @type {cwc.ui.EditorFlags} */
  this.editorFlags = new cwc.ui.EditorFlags();

  /** @type {cwc.ui.EditorType|string} */
  this.editorType = cwc.ui.EditorType.UNKNOWN;

  /** @type {cwc.ui.EditorHint|string} */
  this.editorHints = cwc.ui.EditorHint.UNKNOWN;

  /** @type {Object} */
  this.editorView = {};

  /** @type {string} */
  this.currentEditorView = '';

  /** @type {!string} */
  this.prefix = this.helper.getPrefix('editor');

  /** @type {!CodeMirror.CursorPosition|string} */
  this.cursorPosition = '';

  /** @type {boolean} */
  this.modified = false;

  /** @type {goog.events.EventTarget} */
  this.eventHandler = new goog.events.EventTarget();

  /** @type {Element} */
  this.node = null;

  /** @type {Element} */
  this.nodeEditor = null;

  /** @type {Element} */
  this.nodeInfobar = null;

  /** @type {Element} */
  this.nodeInfobarCurrentMode = null;

  /** @type {Element} */
  this.nodeInfobarLineCol = null;

  /** @type {Element} */
  this.nodeInfobarMode = null;

  /** @type {Element} */
  this.nodeInfobarModes = null;

  /** @type {Element} */
  this.nodeInfobarModeSelect = null;

  /** @type {Element} */
  this.nodeToolbar = null;

  /** @type {Element} */
  this.nodeSelectView = null;

  /** @type {cwc.ui.EditorToolbar} */
  this.toolbar = null;

  /** @type {!Array} */
  this.gutters = [
    'CodeMirror-linenumbers',
    'CodeMirror-breakpoints',
    'CodeMirror-foldgutter',
    'CodeMirror-lint-markers'
  ];

  /** @type {!Array} */
  this.rulers = [{color: '#ccc', column: 80, lineStyle: 'dashed'}];

  /** @type {!string} */
  this.theme = 'default';

  /** @type {Array} */
  this.listener = [];

  /** @private {!boolean} */
  this.isVisible_ = true;

  /** @private {!number} */
  this.syncThrottleTime_ = 2000;

  /** @private {goog.async.Throttle} */
  this.syncThrottle_ = new goog.async.Throttle(
    this.syncJavaScript.bind(this), this.syncThrottleTime_);
};


/**
 * Decorates the given node and adds the code editor.
 * @param {Element} node The target node to add the code editor.
 */
cwc.ui.Editor.prototype.decorate = function(node) {
  this.editorFlags = new cwc.ui.EditorFlags();
  this.editorView = {};
  this.node = node;
  this.modified = false;

  console.log('Decorate', this.name, 'into node', this.node);
  goog.soy.renderElement(
      this.node, cwc.soy.ui.Editor.template, {
        experimental: this.helper.experimentalEnabled(),
        modes: CodeMirror.mimeModes || {},
        prefix: this.prefix
      }
  );

  // Decorate editor tool-bar.
  this.nodeToolbar = goog.dom.getElement(this.prefix + 'toolbar-chrome');
  if (this.nodeToolbar) {
    this.nodeSelectView = goog.dom.getElement(this.prefix + 'view');
    this.toolbar = new cwc.ui.EditorToolbar(this.helper);
    this.toolbar.decorate(this.nodeToolbar, this.node, this.nodeSelectView,
      this.prefix);
  }

  // Decorate code editor.
  this.nodeEditor = goog.dom.getElement(this.prefix + 'code');
  this.decorateEditor(this.nodeEditor);

  // Decorate editor info-bar.
  this.nodeInfobar = goog.dom.getElement(this.prefix + 'infobar');
  this.nodeInfobarCurrentMode = goog.dom.getElement(this.prefix +
    'info-current-mode-text');
  this.nodeInfobarLineCol = goog.dom.getElement(this.prefix + 'info-line-col');
  this.nodeInfobarMode = goog.dom.getElement(this.prefix + 'info-mode');
  this.nodeInfobarModes = goog.dom.getElement(this.prefix + 'info-modes');
  this.nodeInfobarModeSelect = goog.dom.getElement(
    this.prefix + 'info-mode-select');

  // Decorate editor mode select.
  goog.events.listen(this.nodeInfobarModes, goog.events.EventType.CLICK,
    function(event) {
      var value = event.target.firstChild.data;
      this.setEditorMode(value);
    }, false, this);

  // Add event listener to monitor changes like resize and unload.
  var viewportMonitor = new goog.dom.ViewportSizeMonitor();
  this.addEventListener(viewportMonitor, goog.events.EventType.RESIZE,
      this.adjustSize, false, this);

  var layoutInstance = this.helper.getInstance('layout');
  if (layoutInstance) {
    var eventHandler = layoutInstance.getEventHandler();
    this.addEventListener(eventHandler, goog.events.EventType.RESIZE,
        this.adjustSize, false, this);
    this.addEventListener(eventHandler, goog.events.EventType.UNLOAD,
        this.cleanUp_, false, this);
  }
  this.adjustSize();
};


/**
 * Decorates the Code Mirror editor with default options.
 * @param {Element} node
 */
cwc.ui.Editor.prototype.decorateEditor = function(node) {
  console.log('Decorate code editor...');
  if (!node) {
    console.error('Was unable to create editor at node ' + node);
    return;
  }

  var extraKeys = {
    'Ctrl-Q': function(cm) { cm.foldCode(cm.getCursor()); },
    'Ctrl-J': 'toMatchingTag',
    'Cmd-Space': 'autocomplete',
    'Ctrl-Space': 'autocomplete'
  };

  var foldGutterEvent = {
    'rangeFinder': new CodeMirror.fold.combine(CodeMirror.fold.brace,
                                               CodeMirror.fold.comment)};
  var gutterClickEvent = function(cm, n) {
    var info = cm.lineInfo(n);
    cm.setGutterMarker(n,
        'CodeMirror-breakpoints',
        info.gutterMarkers ? null : cwc.ui.Editor.createMarker());
  };
  var cursorEvent = this.updateCursorPosition.bind(this);
  var changeEvent = this.handleChangeEvent.bind(this);
  this.editor = new CodeMirror(node);
  this.editor.setOption('autoCloseBrackets', true);
  this.editor.setOption('autoCloseTags', true);
  this.editor.setOption('extraKeys', extraKeys);
  this.editor.setOption('foldGutter', foldGutterEvent);
  this.editor.setOption('gutters', this.gutters);
  this.editor.setOption('highlightSelectionMatches', { showToken: /\w/});
  this.editor.setOption('lineNumbers', true);
  this.editor.setOption('matchTags', { bothTags: true });
  this.editor.setOption('rulers', this.rulers);
  this.editor.setOption('showTrailingSpace', true);
  this.editor.setOption('styleActiveLine', true);
  this.editor.setOption('styleActiveLine', true);
  this.editor.setOption('hintOptions', this.editorHints);
  this.editor.setOption('theme', this.theme);
  this.editor.on('cursorActivity', cursorEvent);
  this.editor.on('gutterClick', gutterClickEvent);
  this.editor.on('change', changeEvent);
};


/**
 * Shows/Hides the editor.
 * @param {boolean} visible
 */
cwc.ui.Editor.prototype.showEditor = function(visible) {
  this.isVisible_ = visible;
  goog.style.setElementShown(this.node, visible);
  if (visible && this.editor) {
    this.editor.refresh();
  }
};


/**
 * Shows/Hides the editor views like CSS, HTML and JavaScript.
 * @param {boolean} visible
 */
cwc.ui.Editor.prototype.showEditorViews = function(visible) {
  if (this.nodeSelectView) {
    goog.style.setElementShown(this.nodeSelectView, visible);
  }
};


/**
 * Shows/Hide the expand button.
 * @param {boolean} visible
 */
cwc.ui.Editor.prototype.showExpandButton = function(visible) {
  if (this.toolbar) {
    this.toolbar.showExpandButton(visible);
  }
};


/**
 * Shows/Hide the editor type like "text/javascript" inside the info bar.
 * @param {boolean} visible
 */
cwc.ui.Editor.prototype.showEditorTypeInfo = function(visible) {
  if (this.nodeInfobarMode) {
    goog.style.setElementShown(this.nodeInfobarMode, visible);
  }
};


/**
 * Enables/Disables the editor type like "text/javascript" inside the info bar.
 * @param {boolean} enable
 */
cwc.ui.Editor.prototype.enableModeSelect = function(enable) {
  if (this.nodeInfobarModeSelect) {
    cwc.ui.Helper.enableElement(this.nodeInfobarModeSelect, enable);
  }
};


/**
 * Enable/Disable the media button.
 * @param {boolean} enable
 */
cwc.ui.Editor.prototype.enableMediaButton = function(enable) {
  if (this.toolbar) {
    this.toolbar.enableMediaButton(enable);
  }
};


/**
 * Updates the media button appearance.
 * @param {boolean} has_files
 */
cwc.ui.Editor.prototype.updateMediaButton = function(has_files) {
  if (this.toolbar) {
    this.toolbar.updateMediaButton(has_files);
  }
};


/**
 * @param {!string} name
 * @param {!function()} func
 * @param {string=} opt_tooltip
 */
cwc.ui.Editor.prototype.addOption = function(name, func,
    opt_tooltip) {
  if (this.toolbar) {
    this.toolbar.addOption(name, func, opt_tooltip);
  }
};


/**
 * Returns Editor code mode.
 * @return {string}
 */
cwc.ui.Editor.prototype.getEditorMode = function() {
  return this.editor.getOption('mode');
};


/**
 * Sets the Editor Mode to the selected mode.
 * @param {!(cwc.ui.EditorType|string)} mode Editor code mode.
 */
cwc.ui.Editor.prototype.setEditorMode = function(mode) {
  if (mode && mode !== this.editorType) {
    console.log('Set editor mode to: ' + mode);
    this.editor.setOption('mode', mode);
    this.updateInfobar();
    this.updateToolbar();
    this.refreshEditor();
    this.editorType = mode;
  }
};


/**
 * Sets and enabled specific editor hints.
 * @param {!cwc.ui.EditorHint} hints
 */
cwc.ui.Editor.prototype.setEditorHints = function(hints) {
  if (hints && hints !== this.editorHints) {
    console.log('Set editor hints to: ' + hints);
    this.editor.setOption('hintOptions', hints);
    this.refreshEditor();
    this.editorHints = hints;
  }
};


/**
 * @param {string=} opt_name
 * @return {Object}
 */
cwc.ui.Editor.prototype.getEditorContent = function(opt_name) {
  var editorContent = {};

  if (opt_name) {
    if (opt_name in this.editorView) {
      return this.editorView[opt_name].getContent();
    } else {
      console.error('Editor content', opt_name, 'is not defined!');
    }
  } else {
    for (let view in this.editorView) {
      if (this.editorView.hasOwnProperty(view)) {
        editorContent[view] = this.editorView[view].getContent();
      }
    }
  }

  return editorContent;
};


/**
 * @param {!string} content
 * @param {string=} opt_view
 */
cwc.ui.Editor.prototype.setEditorContent = function(content,
    opt_view) {
  var view = opt_view || cwc.file.ContentType.CUSTOM;
  if (view in this.editorView) {
    this.editorView[view].setContent(content);
  } else {
    console.error('Editor view', view, 'is unknown!');
  }
};


/**
 * @param {!string} content
 */
cwc.ui.Editor.prototype.setEditorJavaScriptContent = function(
    content) {
  this.setEditorContent(content, cwc.file.ContentType.JAVASCRIPT);
};


/**
 * Sync JavaScript content from other modules.
 * @param {event=} opt_event
 */
cwc.ui.Editor.prototype.syncJavaScript = function(opt_event) {

  var fileUi = this.helper.getInstance('file').getUi();
  switch (fileUi) {
    case 'blockly':
      var blocklyInstance = this.helper.getInstance('blockly');
      if (blocklyInstance) {
        console.log('Syncing JavaScript from Blockly...');
        this.setEditorJavaScriptContent(blocklyInstance.getJavaScript());
      }
      break;
    default:
      console.log('Unsynced UI mode', fileUi);
  }
};


/**
 * @return {cwc.ui.EditorFlags}
 */
cwc.ui.Editor.prototype.getEditorFlags = function() {
  return this.editorFlags;
};


/**
 * @param {!cwc.ui.EditorFlags} flags
 */
cwc.ui.Editor.prototype.setEditorFlags = function(flags) {
  this.editorFlags = flags;
};


/**
 * Syntax checks for supported formats.
 * @param {!boolean} active
 */
cwc.ui.Editor.prototype.setSyntaxCheck = function(active) {
  this.editor.setOption('lint', active);
};


/**
 * Refreshes the Editor to avoid CSS issues.
 */
cwc.ui.Editor.prototype.refreshEditor = function() {
  this.editor.refresh();
  var layoutInstance = this.helper.getInstance('layout');
  if (layoutInstance) {
    layoutInstance.refresh();
  }
};


/**
 * Undo the last change in the editor.
 * @return {Object}
 */
cwc.ui.Editor.prototype.undoChange = function() {
  this.editor.undo();
  return this.editor.historySize();
};


/**
 * Redo the last change in the editor.
 * @return {Object}
 */
cwc.ui.Editor.prototype.redoChange = function() {
  this.editor.redo();
  return this.editor.historySize();
};


/**
 * Selects all in the editor.
 */
cwc.ui.Editor.prototype.selectAll = function() {
  this.cursorPosition = this.editor.getCursor();
  this.editor.execCommand('selectAll');
};


/**
 * Clears selection in the editor.
 */
cwc.ui.Editor.prototype.selectNone = function() {
  var position = this.cursorPosition || this.editor.getCursor('start');
  this.editor.setCursor(position);
};


/**
 * Insert the text at the current cursor position.
 * @param {!string} text
 */
cwc.ui.Editor.prototype.insertText = function(text) {
  this.editor.replaceSelection(text);
  this.selectNone();
};


/**
 * Change editor view to the given name.
 * @param {!string} name
 */
cwc.ui.Editor.prototype.changeView = function(name) {
  if (!(name in this.editorView)) {
    console.error('Editor view "' + name + '" not exists!');
    return;
  }

  if (!this.editor) {
    return;
  }

  var editorView = this.editorView[name];
  this.editor.swapDoc(editorView.getDoc());
  this.currentEditorView = name;
  this.setEditorMode(editorView.getType());
  this.setEditorHints(editorView.getHints());
};


/**
 * Adds a new editor view with the given name.
 * @param {!string} name
 * @param {string=} opt_content
 * @param {cwc.ui.EditorType=} opt_type
 * @param {cwc.ui.EditorHint=} opt_hints
 * @param {cwc.ui.EditorFlags=} opt_flags
 */
cwc.ui.Editor.prototype.addView = function(name, opt_content, opt_type,
    opt_hints, opt_flags) {
  if (name in this.editorView) {
    console.error('Editor View', name, 'already exists!');
    return;
  }

  console.log('Create Editor View', name,
    (opt_type ? 'with type' : ''), opt_type,
    (opt_hints ? 'and hints' : ''),
    (opt_content ? 'for content:' : ''), '\n...\n' + opt_content + '\n...');

  this.editorView[name] = new cwc.ui.EditorView(opt_content, opt_type,
    opt_hints, opt_flags);

  if (this.toolbar) {
    this.toolbar.addView(name);
    this.updateToolbar();
  }

  this.adjustSize();
};


/**
 * @return {string}
 */
cwc.ui.Editor.prototype.getCurrentView = function() {
  return this.currentEditorView;
};


/**
 * @param {Event=} opt_event
 */
cwc.ui.Editor.prototype.handleChangeEvent = function(opt_event) {
  if (!this.modified) {
    this.modified = true;
    if (this.toolbar) {
      this.toolbar.enableUndoButton(this.modified);
    }
  }
  var guiInstance = this.helper.getInstance('gui');
  if (guiInstance) {
    guiInstance.setStatus(this.modified ? '*' : '');
  }
  this.eventHandler.dispatchEvent(goog.ui.Component.EventType.CHANGE);
};


/**
 * @param {event=} opt_event
 */
cwc.ui.Editor.prototype.handleSyncEvent = function(opt_event) {
  if (opt_event && opt_event['recordUndo'] === false) {
    return;
  }

  if (opt_event['type'] === Blockly.Events.MOVE &&
      opt_event['newInputName'] && opt_event['newParentId'] &&
      opt_event['newInputName'] === opt_event['oldInputName'] &&
      opt_event['newParentId'] === opt_event['oldParentId']) {
    return;
  }

  this.syncThrottle_.fire();
};


/**
 * @return {goog.events.EventTarget}
 */
cwc.ui.Editor.prototype.getEventHandler = function() {
  return this.eventHandler;
};


/**
 * @return {boolean}
 */
cwc.ui.Editor.prototype.isModified = function() {
  return this.modified;
};


/**
 * @return {boolean}
 */
cwc.ui.Editor.prototype.isVisible = function() {
  return this.isVisible_;
};


/**
 * @param {!boolean} modified
 */
cwc.ui.Editor.prototype.setModified = function(modified) {
  this.modified = modified;
};


/**
 * Adjusts size after resize or on size change.
 */
cwc.ui.Editor.prototype.adjustSize = function() {
  if (!this.node || !this.editor) {
    return;
  }

  var parentElement = goog.dom.getParentElement(this.node);
  if (parentElement) {
    var parentSize = goog.style.getSize(parentElement);
    var newHeight = parentSize.height;
    if (this.nodeToolbar) {
      var toolbarSize = goog.style.getSize(this.nodeToolbar);
      newHeight = newHeight - toolbarSize.height;
    }
    if (this.nodeInfobar) {
      var infobarSize = goog.style.getSize(this.nodeInfobar);
      newHeight = newHeight - infobarSize.height;
    }
    this.editor.setSize(parentSize.width, newHeight);
  }
  this.refreshEditor();
};


/**
 * @return {Element}
 */
cwc.ui.Editor.createMarker = function() {
  return goog.dom.createDom(goog.dom.TagName.SPAN, 'CodeMirror-breakpoint');
};


/**
 * Updates the editor Infobar.
 */
cwc.ui.Editor.prototype.updateInfobar = function() {
  console.info('Update Infobar...');
  if (this.nodeInfobarCurrentMode) {
    this.nodeInfobarCurrentMode.textContent = this.getEditorMode();
  }
  if (this.nodeInfobarLineCol) {
    goog.dom.setTextContent(this.nodeInfobarLineCol, '1 : 0');
  }
};


/**
 * Updates the editor Toolbar.
 */
cwc.ui.Editor.prototype.updateToolbar = function() {
  var editorMode = this.getEditorMode();
  if (editorMode !== this.editorType && this.toolbar) {
    console.info('Update Toolbar for', editorMode);
    this.toolbar.updateToolbar(editorMode);
  }
};


/**
 * Updates the cursor position within the editor.
 * @param {CodeMirror} cm
 */
cwc.ui.Editor.prototype.updateCursorPosition = function(cm) {
  if (this.nodeInfobarLineCol) {
    var position = cm.getCursor();
    goog.dom.setTextContent(this.nodeInfobarLineCol,
        (position['line'] + 1) + ' : ' + (position['ch'] + 1));
  }
};


/**
 * Adds an event listener for a specific event on a native event
 * target (such as a DOM element) or an object that has implemented
 * {@link goog.events.Listenable}.
 *
 * @param {EventTarget|goog.events.Listenable} src
 * @param {string} type
 * @param {function(?)} listener
 * @param {boolean=} opt_useCapture
 * @param {Object=} opt_listenerScope
 */
cwc.ui.Editor.prototype.addEventListener = function(src, type,
    listener, opt_useCapture, opt_listenerScope) {
  var eventListener = goog.events.listen(src, type, listener, opt_useCapture,
      opt_listenerScope);
  goog.array.insert(this.listener, eventListener);
};


/**
 * Cleans up the event listener and any other modification.
 * @private
 */
cwc.ui.Editor.prototype.cleanUp_ = function() {
  this.listener = this.helper.removeEventListeners(this.listener, this.name);
  this.modified = false;
};
