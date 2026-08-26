jest.mock('react-dom/client', () => ({
  createRoot: jest.fn(() => ({ render: jest.fn() })),
}));

test('bootstraps the React application into the root element', () => {
  document.body.innerHTML = '<div id="root"></div>';
  require('./index');
  const { createRoot } = require('react-dom/client');
  expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'));
});
