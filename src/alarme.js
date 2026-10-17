/**
 * Alarme sonore du poste de commandement — trois bips à 880 Hz.
 *
 * Partagée par la Situation et PC-OPS (lot 1 du comparatif BFMF 2026,
 * 17/10) : un SOS qui arrivait en silence sur PC-OPS était le premier
 * constat de ce comparatif. Le son ne se déclenche que si l'opérateur
 * l'a activé d'un clic — c'est aussi ce qui débloque l'audio dans les
 * navigateurs qui l'exigent.
 */
export function jouerAlarme() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[0, 260, 520].forEach((decalage) => {
      setTimeout(() => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'square'
        osc.frequency.value = 880
        gain.gain.value = 0.15
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.18)
      }, decalage)
    })
  } catch {
    /* Certains navigateurs bloquent l'audio sans interaction récente
       de l'utilisateur — l'activation du son par un clic suffit
       normalement, mais on ne casse jamais l'écran pour ça. */
  }
}
