//#region src/queue.d.ts
/**
 * Queue class for managing sequential async operations
 */
declare class Queue {
  _queue: Function[];
  _onEmptyCallback: Function;
  _active: boolean;
  /**
   * @param {Function} onEmptyCallback - Called when queue becomes empty
   */
  constructor(onEmptyCallback: any);
  /**
   * Add a function to the queue
   * @param {Function} func - Function that receives a completion callback
   */
  queue(func: any): void;
  /**
   * Process the next item in the queue
   * @private
   */
  _progressQueue(): void;
  /**
   * Clear all items from the queue
   */
  clear(): void;
  /**
   * Mark current operation as complete and progress to next item
   */
  next(): void;
  dispose(): void;
}
//#endregion
//#region src/animator.d.ts
/**
 * Animator class handles frame-by-frame animation playback using sprite sheets
 */
declare class Animator {
  _el: HTMLElement;
  _data: any;
  _mapUrl: string;
  _currentFrameIndex: number;
  _currentFrame: any;
  _exiting: boolean;
  _currentAnimation: any;
  _endCallback: Function | undefined;
  _started: boolean;
  _sounds: {
    [key: string]: HTMLAudioElement;
  };
  currentAnimationName: string | undefined;
  _overlays: HTMLElement[];
  _loop: number | undefined;
  static States: {
    WAITING: number;
    EXITED: number;
  };
  /**
   * @param {HTMLElement} el - The element to animate
   * @param {string} mapUrl - URL to the agent's sprite sheet
   * @param {Object} data - Agent animation data (frames, overlays, sounds)
   * @param {Object} sounds - Map of sound names to audio URLs
   */
  constructor(el: any, mapUrl: any, data: any, sounds: any);
  /**
   * Configure an element for sprite sheet animation
   * @param {HTMLElement} el - Element to setup
   * @returns {HTMLElement}
   * @private
   */
  _setupElement(el: any): any;
  /**
   * Get list of all available animation names
   * @returns {string[]}
   */
  animations(): any[];
  /**
   * Preload audio files for animations
   * @param {Object} sounds - Map of sound names to URLs
   */
  preloadSounds(sounds: any): void;
  /**
   * Check if an animation exists
   * @param {string} name - Animation name
   * @returns {boolean}
   */
  hasAnimation(name: any): boolean;
  /**
   * Signal that current animation should exit at next opportunity
   */
  exitAnimation(): void;
  /**
   * Start playing an animation
   * @param {string} animationName - Name of the animation to play
   * @param {Function} stateChangeCallback - Called with (name, state) when animation state changes
   * @returns {boolean} - True if animation exists and was started
   */
  showAnimation(animationName: any, stateChangeCallback: any): boolean;
  /**
   * Render the current frame by positioning sprite sheet backgrounds
   * @private
   */
  _draw(): void;
  /**
   * Determine the next frame index based on branching logic
   * @returns {number|undefined}
   * @private
   */
  _getNextAnimationFrame(): any;
  /**
   * Play the sound associated with the current frame
   * @private
   */
  _playSound(): void;
  /**
   * Check if we're at the last frame of the animation
   * @returns {boolean}
   * @private
   */
  _atLastFrame(): boolean;
  /**
   * Advance to the next animation frame
   * @private
   */
  _step(): void;
  /**
   * Pause animation execution
   */
  pause(): void;
  /**
   * Resume animation
   */
  resume(): void;
  dispose(): void;
}
//#endregion
//#region src/balloon.d.ts
/**
 * Balloon class for displaying speech bubbles next to the agent
 */
declare class Balloon {
  _targetEl: HTMLElement;
  _balloon: HTMLDivElement;
  _content: HTMLDivElement;
  _tip: HTMLDivElement;
  _hidden: boolean;
  _active: boolean;
  _hold: boolean;
  _hiding: number | null;
  WORD_SPEAK_TIME: number;
  CLOSE_BALLOON_DELAY: number;
  _BALLOON_MARGIN: number;
  _complete: Function;
  _addWord: Function | undefined;
  _loop: number | undefined;
  /**
   * @param {HTMLElement} targetEl - The agent element to attach the balloon to
   */
  constructor(targetEl: any);
  /**
   * Create and append balloon DOM elements
   * @private
   */
  _setup(): void;
  /**
   * Try different positions to keep balloon on screen
   */
  reposition(): void;
  /**
   * Position the balloon relative to the agent
   * @param {string} side - One of: top-left, top-right, bottom-left, bottom-right
   * @private
   */
  _position(side: any): void;
  /**
   * Apply inline styles to the tip element based on balloon side
   * @param {string} side - One of: top-left, top-right, bottom-left, bottom-right
   * @private
   */
  _positionTip(side: any): void;
  /**
   * Check if balloon is positioned outside the viewport
   * @returns {boolean}
   * @private
   */
  _isOut(): boolean;
  /**
   * Display text in the balloon with typewriter effect
   * @param {Function} complete - Callback when speaking is done
   * @param {string} text - Text to display
   * @param {boolean} hold - If true, keep balloon open after speaking
   */
  speak(complete: any, text: any, hold: any): void;
  /**
   * Show the balloon
   */
  show(): void;
  /**
   * Hide the balloon
   * @param {boolean} fast - If true, hide immediately without delay
   */
  hide(fast?: boolean): void;
  /**
   * Complete the hide operation
   * @private
   */
  _finishHideBalloon(): void;
  /**
   * Animate text appearing word by word
   * @param {string} text - Text to animate
   * @param {boolean} hold - If true, keep balloon open after speaking
   * @param {Function} complete - Callback when animation is done
   * @private
   */
  _sayWords(text: any, hold: any, complete: any): void;
  /**
   * Close the balloon and trigger completion callback if held
   */
  close(): void;
  /**
   * Pause the balloon animation and hide timer
   */
  pause(): void;
  /**
   * Resume the balloon animation or hide timer
   */
  resume(): void;
  dispose(): void;
}
//#endregion
//#region src/agent.d.ts
interface AgentLoaders {
  agent: () => Promise<{
    default: any;
  }>;
  sound: () => Promise<{
    default: any;
  }>;
  map: () => Promise<{
    default: string;
  }>;
}
/**
 * Agent class represents an animated character that can move, speak, and perform actions
 */
declare class Agent {
  _queue: Queue;
  _el: HTMLElement;
  _animator: Animator;
  _balloon: Balloon;
  _hidden: boolean;
  _idlePromise: Promise<void> | null;
  _idleResolve: Function | null;
  _offset: {
    top: number;
    left: number;
  };
  _targetX: number;
  _targetY: number;
  _moveHandle: Function;
  _upHandle: Function;
  _dragUpdateLoop: number;
  _dragging: boolean;
  _resizeHandle: () => void;
  _mouseDownHandle: (e: MouseEvent) => void;
  _dblClickHandle: () => void;
  /**
   * @param {string} mapUrl - URL to the agent's sprite sheet
   * @param {Object} data - Agent animation data
   * @param {Object} sounds - Map of sound names to audio URLs
   */
  constructor(mapUrl: string, data: any, sounds: any);
  /**
   * Make the agent gesture towards a specific point
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {boolean} - True if gesture animation was played
   */
  gestureAt(x: any, y: any): boolean;
  /**
   * Hide the agent
   * @param {boolean} [fast] - If true, hide immediately without animation
   * @param {Function} [callback] - Called when hide is complete
   */
  hide(fast: any, callback: any): void;
  /**
   * Move the agent to a specific position
   * @param {number} x - Target X coordinate
   * @param {number} y - Target Y coordinate
   * @param {number} [duration=1000] - Movement duration in milliseconds
   */
  moveTo(x: any, y: any, duration: any): void;
  /**
   * Animate element properties over time using requestAnimationFrame
   * @param {HTMLElement} element - Element to animate
   * @param {Object} props - Properties to animate (e.g., {top: 100, left: 200})
   * @param {number} duration - Animation duration in milliseconds
   * @param {Function} [callback] - Called when animation completes
   * @private
   */
  _animate(element: any, props: any, duration: any, callback: any): void;
  /**
   * Internal animation playback that handles idle animation interruption
   * @param {string} animation - Animation name
   * @param {Function} callback - State change callback
   * @private
   */
  _playInternal(animation: any, callback: any): void;
  /**
   * Play a named animation
   * @param {string} animation - Animation name
   * @param {number} [timeout=5000] - Timeout in milliseconds before auto-exiting
   * @param {Function} [cb] - Callback when animation completes
   * @returns {boolean} - True if animation exists and was queued
   */
  play(animation: any, timeout?: number, cb?: Function): boolean;
  /**
   * Show the agent
   * @param {boolean} [fast] - If true, show immediately without animation
   */
  show(fast: any): boolean;
  /**
   * Make the agent speak text in a speech balloon
   * @param {string} text - Text to display
   * @param {boolean} [hold] - If true, keep balloon open until manually closed
   */
  speak(text: any, hold: any): void;
  /**
   * Close the current speech balloon
   */
  closeBalloon(): void;
  /**
   * Add a delay to the action queue
   * @param {number} [time=250] - Delay in milliseconds
   */
  delay(time: any): void;
  /**
   * Skip the current animation
   */
  stopCurrent(): void;
  /**
   * Stop all animations and clear the queue
   */
  stop(): void;
  /**
   * Check if an animation exists
   * @param {string} name - Animation name
   * @returns {boolean}
   */
  hasAnimation(name: any): boolean;
  /**
   * Get list of all available animations
   * @returns {string[]}
   */
  animations(): any[];
  /**
   * Play a random non-idle animation
   * @returns {boolean}
   */
  animate(): any;
  /**
   * Calculate direction from agent to a point
   * @param {number} x - Target X coordinate
   * @param {number} y - Target Y coordinate
   * @returns {string} - Direction: 'Up', 'Down', 'Left', 'Right', or 'Top'
   * @private
   */
  _getDirection(x: any, y: any): "Right" | "Up" | "Left" | "Down" | "Top";
  /**
   * Handle empty queue by transitioning to idle animation
   * @private
   */
  _onQueueEmpty(): void;
  /**
   * Handle idle animation completion
   * @param {string} name - Animation name
   * @param {number} state - Animation state
   * @private
   */
  _onIdleComplete(name: any, state: any): void;
  /**
   * Check if currently playing an idle animation
   * @returns {boolean}
   * @private
   */
  _isIdleAnimation(): boolean;
  /**
   * Get a random idle animation name
   * @returns {string}
   * @private
   */
  _getIdleAnimation(): any;
  /**
   * Setup event listeners for resizing and interaction
   * @private
   */
  _setupEvents(): void;
  /**
   * Handle double-click to trigger ClickedOn animation or random animation
   * @private
   */
  _onDoubleClick(): void;
  /**
   * Reposition agent to stay within viewport bounds
   */
  reposition(): void;
  /**
   * Handle mouse down to start dragging
   * @param {MouseEvent} e
   * @private
   */
  _onMouseDown(e: any): void;
  /**
   * Initialize drag operation
   * @param {MouseEvent} e
   * @private
   */
  _startDrag(e: any): void;
  /**
   * Calculate offset between click position and agent position
   * @param {MouseEvent} e
   * @returns {{top: number, left: number}}
   * @private
   */
  _calculateClickOffset(e: any): {
    top: number;
    left: number;
  };
  /**
   * Update agent position during drag
   * @private
   */
  _updateLocation(): void;
  /**
   * Handle mouse move during drag
   * @param {MouseEvent} e
   * @private
   */
  _dragMove(e: any): void;
  /**
   * Complete drag operation
   * @private
   */
  _finishDrag(): void;
  /**
   * Clamp x/y to keep the agent within viewport bounds
   * @private
   */
  _clampTarget(): void;
  /**
   * Clamp coordinates to keep the agent within viewport bounds
   * @private
   */
  _clampXY(x: number, y: number): {
    x: number;
    y: number;
  };
  /**
   * Add a function to the action queue
   * @param {Function} func - Function to queue
   * @param {Object} [scope] - Scope to bind function to
   * @private
   */
  _addToQueue(func: any, scope?: any): void;
  dispose(): void;
  /**
   * Pause animations and balloon
   */
  pause(): void;
  /**
   * Resume animations and balloon
   */
  resume(): void;
}
declare function initAgent(loaders: AgentLoaders): Promise<Agent>;
//#endregion
export { initAgent };