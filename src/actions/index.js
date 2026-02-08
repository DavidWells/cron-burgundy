/**
 * Utility actions for cron jobs
 */
import { speak as _speak, sound, toast } from 'action-burgundy'

/**
 * Play a macOS system sound
 * @param {string} name - Sound name (Ping, Pop, Blow, Glass, etc.)
 */
export function playSound(name = 'Ping') {
  try {
    sound(name)
  } catch (err) {
    console.log('Could not play sound:', err.message)
  }
}

/**
 * Speak text using macOS text-to-speech
 * @param {string} text - Text to speak
 */
export function speak(text = 'Hello, world!') {
  try {
    _speak(text)
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
    const soundName = options.sound
      ? (typeof options.sound === 'string' ? options.sound : 'default')
      : undefined
    toast({ title, message, sound: soundName })
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
