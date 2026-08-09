insert into public.problems (slug, title, category, difficulty, sort_order, statement, starter_code)
values
  ('two-sum', 'Two Sum', 'Array', 'Easy', 1, 'Given an array of integers and a target, return the indices of two numbers that add up to the target.', 'function twoSum(nums, target) {\n  // Write your solution here\n}'),
  ('valid-parentheses', 'Valid Parentheses', 'Stack', 'Easy', 2, 'Given a string containing brackets, determine whether its brackets are valid and properly closed.', 'function isValid(s) {\n  // Write your solution here\n}'),
  ('reverse-linked-list', 'Reverse Linked List', 'Linked List', 'Easy', 3, 'Given the head of a singly linked list, reverse the list and return its head.', 'function reverseList(head) {\n  // Write your solution here\n}'),
  ('search-a-2d-matrix', 'Search a 2D Matrix', 'Binary Search', 'Medium', 4, 'Search a matrix whose rows and columns satisfy sorted constraints.', 'function searchMatrix(matrix, target) {\n  // Write your solution here\n}'),
  ('jump-game', 'Jump Game', 'Array', 'Medium', 5, 'Return whether it is possible to reach the last index of an array of jump lengths.', 'function canJump(nums) {\n  // Write your solution here\n}')
on conflict (slug) do update set
  title = excluded.title,
  category = excluded.category,
  difficulty = excluded.difficulty,
  sort_order = excluded.sort_order,
  statement = excluded.statement,
  starter_code = excluded.starter_code,
  updated_at = now();

