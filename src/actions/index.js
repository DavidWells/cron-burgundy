/**
 * Utility actions for cron jobs
 */
import { execSync, execFileSync } from 'child_process'

/**
 * Escape a string for use in AppleScript double-quoted strings
 * @param {string} str
 * @returns {string}
 */
function escapeAppleScript(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

const sounds = [
  'Ping',
  'Pop',
  'Blow',
  'Glass',
  'Frog',
  'Submarine',
  'Purr',
  'Funk',
  'Morse',
  'Sosumi',
  'Basso',
  'Bottle',
]

/**
 * Play a macOS system sound
 * @param {string} sound - Sound name (Ping, Pop, Blow, Glass, etc.)
 */
export function playSound(sound = 'Ping') {
  const isSystemSound = sounds.includes(sound)
  if (isSystemSound) {
    try {
      execFileSync('afplay', [`/System/Library/Sounds/${sound}.aiff`])
    } catch (err) {
      console.log('Could not play sound:', err.message)
    }
  } else {
    try {
      execFileSync('say', [sound])
    } catch (err) {
      console.log('Could not speak:', err.message)
    }
  }
}

/**
 * Speak text using macOS text-to-speech
 * @param {string} text - Text to speak
 */
export function speak(text = 'Hello, world!') {
  try {
    execFileSync('say', [text])
  } catch (err) {
    console.log('Could not speak:', err.message)
  }
}

/**
 * Show a macOS notification
 * @param {string} title
 * @param {string} message
 * @param {{ sound?: boolean | string }} [options] - Play sound with notification
 */
export function notify(title, message, options = {}) {
  try {
    let script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`
    if (options.sound) {
      const soundName = typeof options.sound === 'string' ? options.sound : 'default'
      script += ` sound name "${escapeAppleScript(soundName)}"`
    }
    execFileSync('osascript', ['-e', script])
  } catch (err) {
    console.log('Could not show notification:', err.message)
  }
}

/**
 * All utils bundled for injection
 */
export const utils = {
  playSound,
  speak,
  notify,
}
