import * as React from "react"
import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm",
        className
      )}
      {...props}
    />
  )
}

export { Card }
