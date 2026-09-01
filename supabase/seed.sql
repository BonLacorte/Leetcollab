insert into public.problems (slug, title, category, difficulty, sort_order, statement, starter_code, examples, constraints)
values
  (
    'two-sum',
    'Two Sum',
    'Array',
    'Easy',
    1,
    'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. You may assume exactly one valid answer exists, and you may not use the same element twice.',
    'function twoSum(nums, target) {\n  // Write your solution here\n}',
    '[{"title":"Example 1","input":"nums = [2,7,11,15], target = 9","output":"[0,1]","explanation":"nums[0] + nums[1] equals 9."},{"title":"Example 2","input":"nums = [3,2,4], target = 6","output":"[1,2]"}]'::jsonb,
    array['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9', '-10^9 <= target <= 10^9', 'Exactly one valid answer exists.']
  ),
  (
    'valid-parentheses',
    'Valid Parentheses',
    'Stack',
    'Easy',
    2,
    'Given a string s containing only the characters (, ), {, }, [ and ], determine if the input string is valid. A valid string closes brackets in the correct order and with the same bracket type.',
    'function isValid(s) {\n  // Write your solution here\n}',
    '[{"title":"Example 1","input":"s = \"()\"","output":"true"},{"title":"Example 2","input":"s = \"()[]{}\"","output":"true"},{"title":"Example 3","input":"s = \"(]\"","output":"false"}]'::jsonb,
    array['1 <= s.length <= 10^4', 's consists only of parentheses, brackets, and braces.']
  ),
  (
    'reverse-linked-list',
    'Reverse Linked List',
    'Linked List',
    'Easy',
    3,
    'Given the head of a singly linked list, reverse the list and return the reversed list. You may solve this iteratively or recursively.',
    'function reverseList(head) {\n  // Write your solution here\n}',
    '[{"title":"Example 1","input":"head = [1,2,3,4,5]","output":"[5,4,3,2,1]"},{"title":"Example 2","input":"head = [1,2]","output":"[2,1]"},{"title":"Example 3","input":"head = []","output":"[]"}]'::jsonb,
    array['The number of nodes in the list is in the range [0, 5000].', '-5000 <= Node.val <= 5000']
  ),
  (
    'search-a-2d-matrix',
    'Search a 2D Matrix',
    'Binary Search',
    'Medium',
    4,
    'You are given an m x n integer matrix with each row sorted in non-decreasing order and the first integer of each row greater than the last integer of the previous row. Return true if target is in matrix, or false otherwise.',
    'function searchMatrix(matrix, target) {\n  // Write your solution here\n}',
    '[{"title":"Example 1","input":"matrix = [[1,3,5,7],[10,11,16,20],[23,30,34,60]], target = 3","output":"true"},{"title":"Example 2","input":"matrix = [[1,3,5,7],[10,11,16,20],[23,30,34,60]], target = 13","output":"false"}]'::jsonb,
    array['m == matrix.length', 'n == matrix[i].length', '1 <= m, n <= 100', '-10^4 <= matrix[i][j], target <= 10^4']
  ),
  (
    'jump-game',
    'Jump Game',
    'Array',
    'Medium',
    5,
    'You are given an integer array nums. You are initially positioned at the first index, and each element in the array represents your maximum jump length from that position. Return true if you can reach the last index, or false otherwise.',
    'function canJump(nums) {\n  // Write your solution here\n}',
    '[{"title":"Example 1","input":"nums = [2,3,1,1,4]","output":"true","explanation":"Jump 1 step from index 0 to 1, then 3 steps to the last index."},{"title":"Example 2","input":"nums = [3,2,1,0,4]","output":"false","explanation":"You will always arrive at index 3, whose maximum jump length is 0."}]'::jsonb,
    array['1 <= nums.length <= 10^4', '0 <= nums[i] <= 10^5']
  )
on conflict (slug) do update set
  title = excluded.title,
  category = excluded.category,
  difficulty = excluded.difficulty,
  sort_order = excluded.sort_order,
  statement = excluded.statement,
  starter_code = excluded.starter_code,
  examples = excluded.examples,
  constraints = excluded.constraints,
  updated_at = now();
