/**
 * Utility actions for cron jobs
 */
import { execSync } from 'child_process'

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
      execSync(`afplay /System/Library/Sounds/${sound}.aiff`)
    } catch (err) {
      console.log('Could not play sound:', err.message)
    }
  } else {
    try {
      execSync(`say "${sound}"`)
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
    execSync(`say "${text}"`)
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
    let script = `display notification "${message}" with title "${title}"`
    if (options.sound) {
      const soundName = typeof options.sound === 'string' ? options.sound : 'default'
      script += ` sound name "${soundName}"`
    }
    execSync(`osascript -e '${script}'`)
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
