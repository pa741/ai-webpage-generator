import { logEvent, type Analytics } from 'firebase/analytics';
import { analytics } from './firebase';

// Custom event types for type safety
export interface CustomEventParams {
  event_category?: string;
  event_label?: string;
  value?: number;
  custom_parameter?: string;
}

// Page view tracking
export function trackPageView(page_title: string, page_location: string) {
  if (analytics) {
    logEvent(analytics, 'page_view', {
      page_title,
      page_location
    });
  }
}

// Custom event tracking
export function trackCustomEvent(eventName: string, parameters?: CustomEventParams) {
  if (analytics) {
    logEvent(analytics, eventName, parameters);
  }
}

// Website generation specific events
export function trackWebsiteGeneration(description: string, success: boolean) {
  if (analytics) {
    logEvent(analytics, 'website_generated', {
      event_category: 'content_generation',
      event_label: success ? 'success' : 'failure',
      description_length: description.length,
      success
    });
  }
}

// AI interaction tracking
export function trackAIInteraction(action: string, model?: string) {
  if (analytics) {
    logEvent(analytics, 'ai_interaction', {
      event_category: 'ai',
      event_label: action,
      ai_model: model || 'unknown'
    });
  }
}

// Error tracking
export function trackError(error: string, context: string) {
  if (analytics) {
    logEvent(analytics, 'error_occurred', {
      event_category: 'error',
      event_label: context,
      error_message: error
    });
  }
}

// User engagement tracking
export function trackUserEngagement(action: string, element?: string) {
  if (analytics) {
    logEvent(analytics, 'user_engagement', {
      event_category: 'engagement',
      event_label: action,
      element_id: element
    });
  }
}
