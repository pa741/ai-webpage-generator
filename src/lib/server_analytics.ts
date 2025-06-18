
import { GA_MEASUREMENT_ID, GA_API_SECRET } from '$env/static/private';
export async function logServerSideEvent(eventName: string, parameters?: Record<string, any>) {
  const payload = {
    ...parameters,
    event_name: eventName,
    timestamp: Date.now()
  };

  try {
    const response = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Failed to log event: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error logging server-side event:', error);
  }
}
