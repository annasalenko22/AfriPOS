
import React, { useState } from 'react';

export const Calculator: React.FC = () => {
  const [display, setDisplay] = useState('0');
  const [isOpen, setIsOpen] = useState(false);

  const handleClick = (val: string) => {
    if (val === 'C') {
      setDisplay('0');
    } else if (val === '=') {
      try {
        // Simple eval-like logic for basic operations
        // eslint-disable-next-line no-eval
        const result = eval(display.replace(/[^-+*/.0-9]/g, ''));
        setDisplay(String(result));
      } catch {
        setDisplay('Error');
      }
    } else {
      setDisplay(prev => (prev === '0' || prev === 'Error' ? val : prev + val));
    }
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-4 bg-yellow-400 text-black font-bold p-4 rounded-full shadow-2xl border-2 border-black z-50 no-print"
      >
        CALC
      </button>
    );
  }

  const buttons = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', 'C', '+', '='];

  return (
    <div className="fixed bottom-4 right-4 bg-black p-4 rounded-xl shadow-2xl z-50 w-64 no-print border-2 border-yellow-400">
      <div className="flex justify-between items-center mb-2">
        <span className="text-yellow-400 font-bold text-xs">CALCULATOR</span>
        <button onClick={() => setIsOpen(false)} className="text-white hover:text-red-500">✕</button>
      </div>
      <div className="bg-gray-800 text-white text-right p-3 rounded mb-4 text-2xl font-mono overflow-hidden">
        {display}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {buttons.map(btn => (
          <button
            key={btn}
            onClick={() => handleClick(btn)}
            className={`p-3 text-lg font-bold rounded ${
              btn === '=' ? 'bg-yellow-400 text-black col-span-1' : 'bg-gray-700 text-white'
            } active:scale-95 transition-transform`}
          >
            {btn}
          </button>
        ))}
      </div>
    </div>
  );
};
