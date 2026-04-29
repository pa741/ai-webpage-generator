<svelte:options
    customElement={{
        tag: "google-login",
        props: {
            label: { attribute: "label", type: "String" }
        }
    }}
/>

<script lang="ts">
    import { onMount } from "svelte";
    import {
        getAuth,
        GoogleAuthProvider,
        onAuthStateChanged,
        signInWithPopup,
        signInWithRedirect,
        connectAuthEmulator,
        signOut,
        type User
    } from "firebase/auth";
    import { app } from "$lib/firebase.js";

    let { label = "Sign in with Google" } = $props<{ label?: string }>();

    let currentUser = $state<User | null>(null);
    let loading = $state<boolean>(true);
    let errorMessage = $state<string>("");

    const auth = getAuth(app);
    connectAuthEmulator(auth, "http://localhost:9099");
    const provider = new GoogleAuthProvider();

    async function syncSessionCookie(user: User) {
        try {
            const idToken = await user.getIdToken();
            await fetch("/__session-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idToken })
            });
        } catch (error) {
            console.error("Failed to sync auth cookie", error);
        }
    }

    async function clearSessionCookie() {
        try {
            await fetch("/__session-auth", { method: "DELETE" });
        } catch (error) {
            console.error("Failed to clear auth cookie", error);
        }
    }

    onMount(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            loading = false;
            if (user) {
                errorMessage = "";
                await syncSessionCookie(user);
            } else {
                await clearSessionCookie();
            }
        });

        return () => {
            unsubscribe();
        };
    });

    async function loginWithGoogle() {
        errorMessage = "";

        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            const code =
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                typeof (error as { code?: unknown }).code === "string"
                    ? (error as { code: string }).code
                    : "";

            const shouldUseRedirect =
                code === "auth/popup-blocked" ||
                code === "auth/popup-closed-by-user" ||
                code === "auth/cancelled-popup-request";

            if (shouldUseRedirect) {
                await signInWithRedirect(auth, provider);
                return;
            }

            errorMessage =
                error instanceof Error
                    ? error.message
                    : "Google sign-in failed. Please try again.";
        }
    }

    async function logoutFromGoogle() {
        try {
            await signOut(auth);
        } catch (error) {
            errorMessage =
                error instanceof Error
                    ? error.message
                    : "Sign-out failed. Please try again.";
        }
    }
</script>

{#if !loading}
    <div class="google-login">
        {#if !currentUser}
            <button type="button" class="google-button" onclick={loginWithGoogle}>
                <span class="google-mark" aria-hidden="true">G</span>
                <span>{label}</span>
            </button>
        {:else}
            <button type="button" class="google-signout" onclick={logoutFromGoogle}>
                Sign out{currentUser.displayName ? ` (${currentUser.displayName})` : ""}
            </button>
        {/if}

        {#if errorMessage}
            <p class="google-error">{errorMessage}</p>
        {/if}
    </div>
{/if}

<style>
    .google-login {
        display: inline-flex;
        flex-direction: column;
        gap: 0.5rem;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }

    .google-button {
        align-items: center;
        background: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 999px;
        color: #1f2937;
        cursor: pointer;
        display: inline-flex;
        font-size: 0.95rem;
        font-weight: 600;
        gap: 0.5rem;
        padding: 0.6rem 1rem;
        transition: background-color 120ms ease, border-color 120ms ease;
    }

    .google-button:hover {
        background-color: #f9fafb;
        border-color: #9ca3af;
    }

    .google-mark {
        align-items: center;
        border: 1px solid #d1d5db;
        border-radius: 50%;
        display: inline-flex;
        font-size: 0.8rem;
        font-weight: 700;
        height: 1.4rem;
        justify-content: center;
        line-height: 1;
        width: 1.4rem;
    }

    .google-signout {
        background: transparent;
        border: 1px solid #d1d5db;
        border-radius: 999px;
        color: #374151;
        cursor: pointer;
        font-size: 0.85rem;
        padding: 0.4rem 0.85rem;
        transition: background-color 120ms ease, border-color 120ms ease;
    }

    .google-signout:hover {
        background-color: #f3f4f6;
        border-color: #9ca3af;
    }

    .google-error {
        color: #b91c1c;
        font-size: 0.8rem;
        line-height: 1.2;
        margin: 0;
    }
</style>
