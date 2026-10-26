// Shared pieces every screen is built from, so they all look and move the same way.
// Controls are shadcn/ui components (components/ui); Motion (motion.dev) does the animation, with one
// spring and one ease used everywhere.

import { AnimatePresence, motion, MotionConfig, type HTMLMotionProps, type Transition } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Item } from '../shared/types';
import { Button as ShadcnButton } from './components/ui/button';
import { Icon } from './icons';

export { AnimatePresence, motion };

export const spring: Transition = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 };
export const ease: Transition = { duration: 0.32, ease: [0.22, 1, 0.36, 1] };

/** Wrap a screen: respects "Reduce motion" and uses the house spring by default. */
export function Motion({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      {children}
    </MotionConfig>
  );
}

const MotionButton = motion.create(ShadcnButton);
const VARIANTS = { primary: 'default', secondary: 'secondary', ghost: 'ghost', danger: 'destructive' } as const;

type ButtonProps = HTMLMotionProps<'button'> & { variant?: keyof typeof VARIANTS; size?: 'small' | 'normal' };

/** shadcn's Button with a soft press. */
export function Button({ variant = 'secondary', size = 'normal', type = 'button', ...rest }: ButtonProps) {
  return <MotionButton type={type} whileTap={{ scale: 0.97 }} variant={VARIANTS[variant]} size={size === 'small' ? 'sm' : 'default'} {...rest} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

/** The app icon in miniature: a white folder on butter yellow. Eyes closed while things are stashed;
 *  awake, it blinks every few seconds. */
export function FolderMark({ size = 28, awake = false, tone }: { size?: number; awake?: boolean; tone?: { tile: string; flap: string } }) {
  const blinking = useBlink(awake);
  return (
    <svg className="folder-mark" width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      <rect width="96" height="96" rx="22" fill={tone?.tile ?? '#F2CD5C'} />
      <path d="M16 33 Q16 25 24 25 H37 Q41 25 43.5 28.5 L46.5 32 H72 Q80 32 80 40 V70 Q80 78 72 78 H24 Q16 78 16 70 Z" fill={tone?.flap ?? '#FBEFC6'} />
      <path d="M16 45 Q16 39 22 39 H74 Q80 39 80 45 V70 Q80 78 72 78 H24 Q16 78 16 70 Z" fill="#FFFFFF" />
      {awake ? (
        <g fill="#1C1D22">
          {[37, 59].map((cx) => (
            <motion.ellipse
              key={cx}
              cx={cx}
              cy="59"
              rx="3.6"
              ry="4.2"
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              animate={{ scaleY: blinking ? 0.12 : 1 }}
              transition={{ duration: 0.08 }}
            />
          ))}
        </g>
      ) : (
        <g fill="none" stroke="#1C1D22" strokeWidth="3.4" strokeLinecap="round">
          <path d="M32 58 Q37 63 42 58" />
          <path d="M54 58 Q59 63 64 58" />
        </g>
      )}
    </svg>
  );
}

/** True for a moment every 3 to 7 seconds (and now and then twice in a row). */
function useBlink(on: boolean): boolean {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!on) return;
    let t: ReturnType<typeof setTimeout>;
    const blink = (then: () => void) => {
      setClosed(true);
      t = setTimeout(() => {
        setClosed(false);
        then();
      }, 130);
    };
    const schedule = () => {
      t = setTimeout(() => blink(() => (Math.random() < 0.25 ? (t = setTimeout(() => blink(schedule), 180)) : schedule())), 3000 + Math.random() * 4000);
    };
    schedule();
    return () => clearTimeout(t);
  }, [on]);
  return closed;
}

/** Content that slides open and closed, height and all. */
export function Reveal({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className={className}
          style={{ overflow: 'hidden' }}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={ease}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** One screen replacing another: a short fade and slide. */
export function Swap({ id, children, direction = 1 }: { id: string; children: ReactNode; direction?: 1 | -1 }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={id}
        initial={{ opacity: 0, x: 18 * direction }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -18 * direction }}
        transition={ease}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** A tab, file or app you can put in a folder or leave out. */
export function Pill({ item, on, front, tip, onToggle }: { item: Item; on: boolean; front: boolean; tip: string; onToggle: () => void }) {
  return (
    <motion.button
      layout
      type="button"
      className={`pill ${on ? 'in' : 'out'}`}
      onClick={onToggle}
      title={tip}
      aria-pressed={on}
      whileTap={{ scale: 0.95 }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <span className="pill-mark">{on ? <Icon name="check" /> : <Icon name="plus" />}</span>
      <Icon name={item.kind} className="i kind" />
      <span className="pill-label">{item.label}</span>
      {item.notOpen && <span className="pill-tag">closed</span>}
      {front && <span className="pill-dot" title="You were on this last" />}
    </motion.button>
  );
}

/** "3 tabs · 1 file" */
export function countText(items: Item[]): string {
  const docs = items.filter((i) => i.kind === 'doc' || i.kind === 'folder').length;
  const tabs = items.filter((i) => i.kind === 'tab').length;
  const apps = items.filter((i) => i.kind === 'app').length;
  const parts = [];
  if (tabs) parts.push(`${tabs} ${tabs === 1 ? 'tab' : 'tabs'}`);
  if (docs) parts.push(`${docs} ${docs === 1 ? 'file' : 'files'}`);
  if (apps) parts.push(`${apps} ${apps === 1 ? 'app' : 'apps'}`);
  return parts.join(' · ') || 'Nothing picked';
}
