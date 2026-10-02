import * as React from 'react'
import { SelectContent as ConteudoPedido } from '@/components/pedido-ui/select'
import { cn } from '@/lib/utils'

/** O portal fica fora da página; esta classe leva os mesmos tokens até ele. */
export const SelectContent = React.forwardRef<
  React.ElementRef<typeof ConteudoPedido>,
  React.ComponentPropsWithoutRef<typeof ConteudoPedido>
>(({ className, ...props }, ref) => <ConteudoPedido ref={ref} className={cn('controle-vendas-original-portal', className)} {...props} />)
SelectContent.displayName = 'SelectContentControleVendas'
