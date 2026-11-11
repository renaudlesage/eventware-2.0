import { useEffect, useState } from 'react'
import { surEcriture } from './temoinEcriture'

/** Le témoin « Enregistré ✓ » : discret, deux secondes, annoncé aux lecteurs d'écran. */
export default function TemoinEnregistre() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let t = null
    const montrer = () => {
      setVisible(true)
      clearTimeout(t)
      t = setTimeout(() => setVisible(false), 2200)
    }
    const fin = surEcriture(montrer)
    return () => {
      fin()
      clearTimeout(t)
    }
  }, [])
  return (
    <div className={`temoin-ecrit ${visible ? 'visible' : ''}`} role="status" aria-live="polite">
      {visible ? 'Enregistré ✓' : ''}
    </div>
  )
}
