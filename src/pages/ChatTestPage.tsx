import React from 'react';
import { OpenRouterChat } from '../components/OpenRouterChat';

export const ChatTestPage: React.FC = () => {
  return (
    <div className="container mx-auto p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">AI Chat Test</h1>
        <OpenRouterChat />
      </div>
    </div>
  );
};
