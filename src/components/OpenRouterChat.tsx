import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Loader2, Send, Bot, User, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { createOpenRouterService, ChatMessage, StreamChunk, Conversation } from '../services/openrouter';
import { API_RECOVERED_EVENT, getApiErrorMessage } from '@/lib/api';
import { toast } from "sonner";

interface OpenRouterChatProps {
  model?: string;
  className?: string;
}

export const OpenRouterChat: React.FC<OpenRouterChatProps> = ({
  model = 'nvidia/nemotron-nano-9b-v2:free',
  className
}) => {
  const conversationsCacheKey = "openrouter_conversations_cache_v1";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const [showConversations, setShowConversations] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const openRouterService = useMemo(() => createOpenRouterService(), []);

  const loadConversations = useCallback(async () => {
    try {
      const convs = await openRouterService.getConversations();
      setConversations(convs);
      localStorage.setItem(
        conversationsCacheKey,
        JSON.stringify({
          saved_at: Date.now(),
          conversations: convs,
        })
      );
    } catch (error) {
      console.error('Failed to load conversations:', error);
      try {
        const cachedRaw = localStorage.getItem(conversationsCacheKey);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw) as { conversations?: Conversation[] };
          if (Array.isArray(parsed?.conversations)) {
            setConversations(parsed.conversations);
            return;
          }
        }
      } catch {
        // ignore malformed cache
      }
      toast.error(getApiErrorMessage(error, 'Failed to load conversations'));
    }
  }, [conversationsCacheKey, openRouterService, toast, getApiErrorMessage]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages, currentResponse]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const onRecovered = () => {
      void loadConversations();
    };
    window.addEventListener("online", onRecovered);
    window.addEventListener(API_RECOVERED_EVENT, onRecovered as EventListener);

    return () => {
      window.removeEventListener("online", onRecovered);
      window.removeEventListener(API_RECOVERED_EVENT, onRecovered as EventListener);
    };
  }, [loadConversations]);

  const loadConversation = async (conversationId: number) => {
    try {
      const conversation = await openRouterService.getConversationMessages(conversationId);
      setMessages(conversation.messages);
      setCurrentConversationId(conversationId);
      setShowConversations(false);
    } catch (error) {
      console.error('Failed to load conversation:', error);
      toast.error(getApiErrorMessage(error, 'Failed to load conversation'));
    }
  };

  const createNewConversation = async () => {
    try {
      const conversation = await openRouterService.createConversation('New Chat', model);
      setMessages([]);
      setCurrentConversationId(conversation.id);
      void loadConversations();
      setShowConversations(false);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      toast.error(getApiErrorMessage(error, 'Failed to create conversation'));
    }
  };

  const deleteConversation = async (conversationId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await openRouterService.deleteConversation(conversationId);
      if (currentConversationId === conversationId) {
        setMessages([]);
        setCurrentConversationId(null);
      }
      void loadConversations();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      toast.error(getApiErrorMessage(error, 'Failed to delete conversation'));
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input.trim()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setCurrentResponse('');

    try {
      const conversationHistory = [...messages, userMessage];
      
      const result = await openRouterService.streamChat(
        conversationHistory,
        model,
        currentConversationId || undefined,
        (chunk: StreamChunk) => {
          if (!chunk.done) {
            setCurrentResponse(prev => prev + chunk.content);
          }
        }
      );

      setCurrentResponse('');
      if (result.content.trim() !== '') {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: result.content,
          },
        ]);
      }

      if (result.conversationId) {
        setCurrentConversationId(result.conversationId);
        void loadConversations();
      }
    } catch (error) {
      console.error('Chat error:', error);
      setCurrentResponse('');
      toast.error(getApiErrorMessage(error, "Failed to get AI response. Please try again."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className={`h-[600px] flex ${className}`}>
      {/* Conversation Sidebar */}
      <div className={`${showConversations ? 'w-64' : 'w-0'} transition-all duration-300 border-r bg-muted/50`}>
        <div className="p-4 h-full flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Conversations</h3>
            <Button size="sm" onClick={createNewConversation}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-2">
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    currentConversationId === conversation.id
                      ? 'bg-primary/10 border border-primary/20'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => loadConversation(conversation.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm truncate">{conversation.title}</h4>
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        {conversation.latest_message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(conversation.last_message_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => deleteConversation(conversation.id, e)}
                      className="opacity-0 hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        <Card className="h-full flex flex-col border-none rounded-none">
          <CardHeader className="flex-shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                AI Chat Assistant
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConversations(!showConversations)}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-4 p-4">
            <ScrollArea 
              ref={scrollAreaRef}
              className="flex-1 pr-4"
            >
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex gap-3 ${
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {message.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Bot className="h-4 w-4" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-lg p-3 ${
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                    {message.role === 'user' && (
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && currentResponse && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="max-w-[80%] rounded-lg p-3 bg-muted">
                      <p className="text-sm whitespace-pre-wrap">
                        {currentResponse}
                        <Loader2 className="inline-block h-3 w-3 ml-1 animate-spin" />
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                disabled={isLoading}
                className="resize-none"
                rows={3}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!input.trim() || isLoading}
                size="icon"
                className="self-end"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
