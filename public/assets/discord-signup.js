"use strict";

const nameField = document.getElementById("name");
const nameError = document.getElementById("name-error");

function reportMissingName(event) {
  event.preventDefault();
  nameField.setAttribute("aria-invalid", "true");
  nameError.textContent = "성명을 입력해 주세요.";
  nameField.focus();
}

nameField.addEventListener("invalid", reportMissingName);
nameField.form.addEventListener("submit", (event) => {
  if (!nameField.value.trim()) reportMissingName(event);
});
nameField.addEventListener("input", () => {
  if (!nameField.value.trim()) return;
  nameField.removeAttribute("aria-invalid");
  nameError.textContent = "";
});
