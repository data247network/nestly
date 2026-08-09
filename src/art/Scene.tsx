import { SCENES } from './figures.js'

type SceneName = keyof typeof SCENES

/**
 * Renders one of the shared family illustrations.
 *
 * The drawings live in `figures.js` as markup strings so the exact same module
 * can be imported by the Node scripts that generate the brochure and the parent
 * flyer. Injecting them here is safe: the markup is authored in this repo, not
 * user input.
 */
export function Scene({
  name,
  className = '',
  title,
}: {
  name: SceneName
  className?: string
  title?: string
}) {
  const svg = (SCENES[name] as () => string)()
  return (
    <div
      className={className}
      role="img"
      aria-label={title ?? 'Nestly family illustration'}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
