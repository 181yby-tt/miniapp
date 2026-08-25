const headerCell = (value) => ({
  value,
  type: String,
  fontWeight: 'bold',
  textColor: '#FFFFFF',
  backgroundColor: '#31574B',
  align: 'center',
  height: 24,
});

const textCell = (value) => ({ value: String(value ?? ''), type: String, format: '@' });

export const STUDENT_CREDENTIAL_COLUMNS = [
  { width: 14 },
  { width: 18 },
  { width: 14 },
  { width: 16 },
  { width: 18 },
  { width: 18 },
];

export function buildStudentCredentialSheet(credentials) {
  return [
    ['姓名', '学号', '年级', '班级', '登录账号', '初始密码'].map(headerCell),
    ...credentials.map((item) => [
      textCell(item.name),
      textCell(item.student_no),
      textCell(item.grade),
      textCell(item.class_name),
      textCell(item.username),
      textCell(item.password),
    ]),
  ];
}
