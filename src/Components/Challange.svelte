<script lang="ts">
  import { Turnstile } from 'svelte-turnstile';
  import { invalidateAll } from '$app/navigation';
  import { PUBLIC_TURNSTILE_SITE_KEY } from '$env/static/public';

  // Use $state for reactive values within the component.
  let isLoading = $state(false);
  let errorMessage = $state('');

  const handleSuccess = async (event: CustomEvent<{ token:string }>) => {
    const { token } = event.detail;
    isLoading = true;
    errorMessage = '';

    try {
      const response = await fetch('/api/verify-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        throw new Error('Verification failed. Please try again.');
      }

      // This part remains the same. It tells SvelteKit to
      // re-run the layout load function.
      await invalidateAll();

    } catch (error) {
      if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = 'An unknown error occurred.';
      }
      // If there's an error, we stop the loading state.
      isLoading = false; 
    }
  };
</script>

<main style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
  {#if isLoading}
    <h1>Verifying...</h1>
    <p>Please wait a moment.</p>
  {:else}
    <h1>Please verify you are human to continue.</h1>
    
    <Turnstile siteKey={PUBLIC_TURNSTILE_SITE_KEY} on:success={handleSuccess} />

    {#if errorMessage}
      <p style="color: red; margin-top: 1em;">{errorMessage}</p>
    {/if}
  {/if}
</main>