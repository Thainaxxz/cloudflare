// theme.js
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

const sunIcon = `<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>`;
const moonIcon = `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`;

const currentTheme = localStorage.getItem('theme') || 'dark';
document.body.setAttribute('data-theme', currentTheme);

if (themeIcon) {
  themeIcon.innerHTML = currentTheme === 'light' ? moonIcon : sunIcon;
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const theme = document.body.getAttribute('data-theme');
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    if (themeIcon) {
      themeIcon.innerHTML = newTheme === 'light' ? moonIcon : sunIcon;
    }
  });
}