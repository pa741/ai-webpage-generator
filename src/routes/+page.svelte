<script lang="ts">
</script>

<div class="app">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <div class="flex flex-col min-h-screen">
    <main class="flex-1 flex flex-col p-4 w-full max-w-2xl mx-auto box-border">
      <!--
      card component

      -->
      <div class="bg-white shadow-md rounded-lg p-6 mb-6">
        <h1 class="text-2xl font-bold mb-4">This Webpage is infinite</h1>
        <p class="text-gray-700">
          There are no 404 urls. Add whatever route you see fit. It will be
          created
        </p>
      </div>
      <div class="bg-white shadow-md rounded-lg p-6 mb-6">
        <h2 class="text-xl font-semibold mb-2">Example Routes</h2>
        <ul class="list-disc pl-5 text-gray-700">
          <li>
            <a href="/about" class="text-blue-500 hover:underline">/about</a>
          </li>
          <li>
            <a href="/contact" class="text-blue-500 hover:underline">/contact</a
            >
          </li>
          <li>
            <a href="/blog" class="text-blue-500 hover:underline">/blog</a>
          </li>
        </ul>
      </div>
    </main>
  </div>
</div>

<style>
</style>
