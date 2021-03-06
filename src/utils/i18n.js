/**
 * @fileoverview Internationalization and localization (i18n).
 *
 * @license Copyright 2017 The Coding with Chrome Authors.
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
goog.provide('cwc.utils.I18n');

goog.require('cwc.utils.Logger');



/**
 * Helper for i18n.
 * @constructor
 * @final
 * @export
 */
cwc.utils.I18n = function() {

  /** @type {!string} */
  this.name = 'i18n';

  /** @private {!cwc.utils.LogLevel} */
  this.loglevel_ = cwc.utils.LogLevel.NOTICE;

  /** @private {!cwc.utils.Logger} */
  this.log_ = new cwc.utils.Logger(this.loglevel_, this.name);

  /** @type {!string} */
  this.language = '';

  /** @type {!string} */
  this.fallbackLanguage = 'en';

  /** @type {!Object} */
  this.untranslated = {};

  /** @type {!string} */
  this.blacklistNodeId = 'cwc-i18n-blacklist';

  /** @type {!string} */
  this.scriptNodeId = 'cwc-i18n-language';

  /** @type {!Object} */
  this.usage = {};

  /** @private {!string} */
  this.blacklistNodeUrl_ = '';

  /** @private {!string} */
  this.scriptNodeUrl_ = '';
};


/**
 * @param {Function=} opt_callback
 * @param {string=} opt_language
 * @param {string=} opt_language_file
 * @param {string=} opt_blacklist_file
 */
cwc.utils.I18n.prototype.prepare = function(opt_callback, opt_language,
    opt_language_file, opt_blacklist_file) {
  // Register global Locales variable
  window['Locales'] = {};
  window['Locales']['blacklist'] = [];

  // Register global handler
  window['i18t'] = this.translate.bind(this);
  window['i18soy'] = this.translateSoy.bind(this);

  // Callback handling
  var callbackHandling = function() {
    this.setLanguage(opt_language);
    if (goog.isFunction(opt_callback)) {
      opt_callback();
    }
  }.bind(this);

  // Load optional files like blacklist and language
  if (opt_blacklist_file && !opt_language_file) {
    this.loadBlacklistFile_(opt_blacklist_file, callbackHandling);
  } else if (opt_blacklist_file && opt_language_file) {
    this.loadBlacklistFile_(opt_blacklist_file, function() {
      this.loadLanguageFile_(opt_language_file, callbackHandling);
    }.bind(this));
  } else if (opt_language_file) {
    this.loadLanguageFile_(opt_language_file, callbackHandling);
  } else {
    callbackHandling();
  }
};


/**
 * Translate the given text to the current language.
 * @param {!string} key
 * @param {string=} opt_text
 * @param {Object=} opt_options
 * @return {!string}
 */
cwc.utils.I18n.prototype.translate = function(key, opt_text, opt_options) {

  if (!Locales || !Locales[this.language] ||
      typeof Locales['blacklist'][key] !== 'undefined') {
    return opt_text || key;
  }

  if (typeof Locales[this.language][key] === 'undefined') {
    this.handleMissingKey_(key, opt_text);
    return opt_text || key;
  }

  return Locales[this.language][key];
};


/**
 * Translate the given soy context to the current language.
 * @param {!string} text
 * @param {Object=} opt_values
 * @return {!string}
 */
cwc.utils.I18n.prototype.translateSoy = function(text, opt_values) {
  if (!opt_values) {
    return this.translate(text);
  }

  var indirect = (/^\{\$\w+\}$/.test(text));
  if (!indirect) {
    text = this.translate(text);
  }
  text = text.replace(/\{\$([^}]+)}/g, function(match, key) {
    return (opt_values != null && key in opt_values) ? opt_values[key] : match;
  });

  return indirect ? this.translate(text) : text;
};


/**
 * @return {!string}
 */
cwc.utils.I18n.prototype.getLanguage = function() {
  if (!this.language) {
    if (typeof chrome !== 'undefined' && typeof chrome.i18n !== 'undefined') {
      return chrome.i18n.getUILanguage();
    } else if (this.fallbackLanguage) {
      return this.fallbackLanguage;
    }
  }
  return this.language;
};


/**
 * @param {string=} opt_language
 */
cwc.utils.I18n.prototype.setLanguage = function(opt_language) {
  this.language = opt_language || this.getLanguage();

  if (!Locales) {
    this.log_.error('Global variable "Locales" is undefined.');
  } else if (Locales && Object.keys(Locales).length == 0) {
    this.log_.error('Unable to find any language file.');
  } else if (!Locales[this.language]) {
    this.log_.error('Language', this.language, ' is untranslated.');
  }
};


/**
 * @param {string=} opt_language
 * @param {string=} opt_text
 */
cwc.utils.I18n.prototype.getLanguageData = function(opt_language, opt_text) {
  var language = opt_language || this.getLanguage();
  if (opt_text) {
    return Locales[language][opt_text];
  }
  return Locales[language];
};


/**
 * @return {!string}
 */
cwc.utils.I18n.prototype.getToDo = function() {
  var counter = 0;
  var result = '';
  for (let textId in this.untranslated) {
    if (this.untranslated.hasOwnProperty(textId)) {
      result += '  \'' + textId + '\': \'' + textId + '\',\n';
    }
    counter += 1;
  }
  if (result) {
    console.log('Found', counter, 'untranslated text for', this.getLanguage());
    console.log('File: src/locales/' + this.getLanguage() + '/translation.js');
    console.log(result);
  }
  return result;
};


/**
 * Adding blacklist file.
 * @param {!string} file_url
 * @param {Function=} opt_callback
 * @private
 */
cwc.utils.I18n.prototype.loadBlacklistFile_ = function(file_url, opt_callback) {
  if (this.blacklistNodeUrl_ === file_url) {
    return;
  }
  this.log_.info('Loading blacklist file:', file_url);
  var headNode = document.head || document.getElementsByTagName('head')[0];
  var oldScriptNode = document.getElementById(this.blacklistNodeId);
  if (oldScriptNode) {
    oldScriptNode.parentNode.removeChild(oldScriptNode);
  }
  var scriptNode = document.createElement('script');
  scriptNode.id = this.blacklistNodeId;
  if (goog.isFunction(opt_callback)) {
    scriptNode.onload = opt_callback;
  }
  headNode.appendChild(scriptNode);
  scriptNode.src = file_url;
  this.blacklistNodeUrl_ = file_url;
};


/**
 * Adding language file.
 * @param {!string} file_url
 * @param {Function=} opt_callback
 * @private
 */
cwc.utils.I18n.prototype.loadLanguageFile_ = function(file_url, opt_callback) {
  if (this.scriptNodeUrl_ === file_url) {
    return;
  }
  this.log_.info('Loading language file:', file_url);
  var headNode = document.head || document.getElementsByTagName('head')[0];
  var oldScriptNode = document.getElementById(this.scriptNodeId);
  if (oldScriptNode) {
    oldScriptNode.parentNode.removeChild(oldScriptNode);
  }
  var scriptNode = document.createElement('script');
  scriptNode.id = this.scriptNodeId;
  if (goog.isFunction(opt_callback)) {
    scriptNode.onload = opt_callback;
  }
  headNode.appendChild(scriptNode);
  scriptNode.src = file_url;
  this.scriptNodeUrl_ = file_url;
};


/**
 * @param {!string} key
 * @param {string=} opt_text
 * @private
 */
cwc.utils.I18n.prototype.handleMissingKey_ = function(key, opt_text) {
  if (!/[a-zA-Z]{2,}/.test(key)) {
    return;
  }

  if (typeof this.untranslated[key] === 'undefined') {
    if (opt_text) {
      this.log_.warn('[i18n] Untranslated Key', key, 'with text:', opt_text);
    } else {
      this.log_.warn('[i18n] Untranslated Key', key);
    }
    this.untranslated[key] = 1;
  } else {
    this.untranslated[key]++;
  }
};
