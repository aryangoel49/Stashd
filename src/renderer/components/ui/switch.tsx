// shadcn/ui Switch, themed for Stashd: yellow when on.
import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full border-0 p-0 shadow-[inset_0_0_0_0.5px_var(--hair)] transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-secondary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[14px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-[2px]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
