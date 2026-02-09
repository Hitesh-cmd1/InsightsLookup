import pandas as pd
import os
from pathlib import Path

emp_sheet = "empsheet.xlsx"
emp_exp_ids_sheet = "emp_exp_ids_sheet.xlsx"
emp_edu_ids_sheet = "emp_edu_ids_sheet.xlsx"
exp_sheet = "expsheet.xlsx"
edu_sheet = "edu_sheet.xlsx"

def get_next_id(file_path, id_column='ID'):
    """Get the next ID for a sheet. Returns 1 if file doesn't exist."""
    if os.path.exists(file_path):
        try:
            df = pd.read_excel(file_path)
            if id_column in df.columns and len(df) > 0:
                return int(df[id_column].max()) + 1
        except:
            pass
    return 1

def save(name, exp_list, edu_list):
    # Get or create employee ID
    emp_id = get_next_id(emp_sheet, 'ID')
    
    # Save employee to emp_sheet
    emp_data = pd.DataFrame([{'ID': emp_id, 'NAME': name}])
    if os.path.exists(emp_sheet):
        existing_emp = pd.read_excel(emp_sheet)
        emp_data = pd.concat([existing_emp, emp_data], ignore_index=True)
    emp_data.to_excel(emp_sheet, index=False)
    
    # Save experience entries
    emp_exp_relations = []
    if exp_list:
        exp_data_list = []
        exp_id = get_next_id(exp_sheet, 'ID')
        for exp in exp_list:
            # exp format: [org, title, date, address]
            exp_data_list.append({
                'ID': exp_id,
                'Org': exp[0] if len(exp) > 0 else None,
                'Role': exp[1] if len(exp) > 1 else None,
                'Tenure': exp[2] if len(exp) > 2 else None,
                'Address': exp[3] if len(exp) > 3 else None
            })
            emp_exp_relations.append({'EmpId': emp_id, 'ExpId': exp_id})
            exp_id = exp_id+1
        
        exp_df = pd.DataFrame(exp_data_list)
        if os.path.exists(exp_sheet):
            existing_exp = pd.read_excel(exp_sheet)
            exp_df = pd.concat([existing_exp, exp_df], ignore_index=True)
        exp_df.to_excel(exp_sheet, index=False)
        
        # Save emp-exp relations
        if emp_exp_relations:
            relations_df = pd.DataFrame(emp_exp_relations)
            if os.path.exists(emp_exp_ids_sheet):
                existing_relations = pd.read_excel(emp_exp_ids_sheet)
                relations_df = pd.concat([existing_relations, relations_df], ignore_index=True)
            relations_df.to_excel(emp_exp_ids_sheet, index=False)
    
    # Save education entries
    emp_edu_relations = []
    if edu_list:
        edu_data_list = []
        edu_id = get_next_id(edu_sheet, 'ID')

        for edu in edu_list:
            # edu format: [school, degree]
            edu_data_list.append({
                'ID': edu_id,
                'School': edu[0] if len(edu) > 0 else None,
                'Degree': edu[1] if len(edu) > 1 else None
            })
            emp_edu_relations.append({'EmpId': emp_id, 'EduId': edu_id})
            edu_id= edu_id+1
        edu_df = pd.DataFrame(edu_data_list)
        if os.path.exists(edu_sheet):
            existing_edu = pd.read_excel(edu_sheet)
            edu_df = pd.concat([existing_edu, edu_df], ignore_index=True)
        edu_df.to_excel(edu_sheet, index=False)
        
        # Save emp-edu relations
        if emp_edu_relations:
            relations_df = pd.DataFrame(emp_edu_relations)
            if os.path.exists(emp_edu_ids_sheet):
                existing_relations = pd.read_excel(emp_edu_ids_sheet)
                relations_df = pd.concat([existing_relations, relations_df], ignore_index=True)
            relations_df.to_excel(emp_edu_ids_sheet, index=False)
    
    return emp_id