import React from 'react'
import { tw , color } from '../constants/tailwind'
import { FlowChart } from "./FlowChart";

export function MethanePanel({ flowData, selection, onSelectionChange, resultsPageMode }) {
    return (
        <div className={`${tw.panel} min-w-0 min-h-0`} style={{ backgroundColor: color.card, padding: '0.75rem' }}>
          <div className='h-full w-full min-w-0 min-h-0'>
            <FlowChart
              flowData={flowData}
              selection={selection}
              onSelectionChange={onSelectionChange}
              resultsPageMode={resultsPageMode}
            />
          </div>
        </div>
    );
}

