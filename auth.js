const API_BASE = (typeof localStorage !== 'undefined' && localStorage.getItem('API_BASE')) || 'http://localhost:3000';

function isAuthPage() {
  try {
    const p = (window.location.pathname || '').toLowerCase();
    if (p.endsWith('login.html') || p.endsWith('/login') || p.endsWith('login')) return true;
    if (p.endsWith('register.html') || p.endsWith('/register') || p.endsWith('register')) return true;
  } catch {}
  // Fallback by DOM presence
  return !!document.getElementById('loginForm') || !!document.getElementById('registerForm');
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = loginForm.username.value;
      const password = loginForm.password.value;

      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (res.ok && data.auth) {
          localStorage.setItem('token', data.token);
          window.location.href = 'index.html';
        } else {
          alert(data.message || `Login failed (${res.status})`);
        }
      } catch (error) {
        console.error('Error:', error);
        alert('Tidak dapat menghubungi server. Pastikan API berjalan.');
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = registerForm.username.value;
      const password = registerForm.password.value;

      try {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username, password })
        });

        let data = {};
        try { data = await res.json(); } catch {}

        if (res.status === 201) {
          alert('Registration successful! Please login.');
          window.location.href = 'login.html';
        } else {
          alert(data.message || `Registration failed (${res.status})`);
        }
      } catch (error) {
        console.error('Error:', error);
        alert('Tidak dapat menghubungi server. Pastikan API berjalan.');
      }
    });
  }
});

function checkAuth() {
  const token = localStorage.getItem('token');
  if (!token && !isAuthPage()) {
    window.location.href = 'login.html';
  }
}

function logout() {
  localStorage.removeItem('token');
  window.location.href = 'login.html';
}

// Check authentication on non-auth pages (robust against routing without .html)
if (!isAuthPage()) {
  checkAuth();
}
