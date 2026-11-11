/*
 * Copies the player's settings into the live CONFIG sections the game reads each frame.
 * The base values (what the game was designed with) are remembered once, so a multiplier
 * setting never compounds.
 */

export function createSettingsApplier(config, settings) {
  const baseMouse = config.player.mouseSensitivity;

  return function apply() {
    config.player.fov = settings.get('fov');
    config.player.mouseSensitivity = baseMouse * settings.get('mouseSensitivity');
    config.player.adsSensitivity = settings.get('adsSensitivity');
    config.gamepad.lookSpeed = settings.get('padLookSpeed');
    config.gamepad.lookCurve = settings.get('padLookCurve');
    config.gamepad.deadzone = settings.get('padDeadzone');
    config.gamepad.triggerThreshold = settings.get('padTriggerThreshold');
    config.gamepad.invertY = settings.get('padInvertY');
    config.gamepad.moveStick = settings.get('padMoveStick');
  };
}
