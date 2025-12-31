"""
input_box 輸入框
output_box 輸出框
button 按鈕
window 窗口
thing to do:gernerate prompt to ai(with choosing file to ai). get return from ai. vs code get ai return. user aspect or reject.
"""


class window():
    def __init__(self,title,size:[int,int]):
        
        self.title=title
        self.size=size
        self.grid=[]
        self.from_top_see=[]
        self.from_left_see=[]
        self.from_right_see=[]
        self.from_bottom_see=[]
        

    def open(self):
        print("open this window")
    def close(self):
        print("close this window")
    def hide(self):
        print("hide this window")
    def show(self):
        print("show this window")

class button():
    def __init__(self,text,bg_colar,text_colar):
        self.text=text
        if type(bg_colar)==str:
            self.bg_colar="the colar word"
        else:
            self.bg_colar=bg_colar
        if type(text_colar)==str:
            self.test_colar="the colar word"
        else:self.text_colar=text_colar


#system variable define
input_box=[]
output_box=[]
toggle_switch=[]
project_name="the project to process was set in data.json by projectIO.py"
project_path="the project path to process was set in data.json by projectIO.py"
#system function define
def click(a):
    print(f"click button {a}")
def isuseable(a):
    print(f"return if {a} window show and opened")
#main code

#window initialize
main_window=window("coder",[500,220])
control_file_window=window("control selected files",[600,500])
enter_window=window(f"workspace of project {project_name}",[700,600])
coped_project_choose_window=window("choose coped project to enter",[700,500])#may not be used
save_from_coped_to_origin_project_window=window("save from coped to origin project",[700,500])#may not be used
project_choose_window=window("choose project to process",[700,500])
vs_code="VS Code with our extension, not python window"
#initialize

#in main_window
control_selected_file_button=button("control selected files")
enter_button=button("enter")
exit_button=button("exit")

#in control_file_window
input_box.append("可以勾選的選單，資料夾可以展開")#index 0
apply_button=button("apply")#apply the change in input_box[0]
cancel_button=button("cancel")#cancel action
#in enter_window
source_button=button("source")
coped_button=button("coped")
toggle_switch.append("selected file of source")
toggle_switch.append("selected file of shadow")
toggle_switch.append("different from source to coped")
input_box.append("可以輸入的框")#index 1
Open_vs_code_button=button("Open IDE of source")
generate_chat_txt_button=button("generate prompt")
toggle_switch.append("vscode from source or coped")#index 4
output_box.append("Log 輸出")#index 0
#in project_choose_window
input_box.append("可以勾選的選單，資料夾可以展開, 用來選擇project,可以選origin project或是 coped project, 其中origin project會有特別標示")#index 2
apply_button=button("apply")#apply the change in input_box[2]
cancel_button=button("cancel")#cancel action


#main code

##logic
main_window.open()
control_allow_to_ai_file_in_this_project=button("control selected files")
if click(control_allow_to_ai_file_in_this_project):
    control_file_window.open()
if click(enter_button):
    enter_window.open()
if click(exit_button):
    main_window.close()

##ui
main_window.from_buttom_see=[[control_selected_file_button,enter_button,exit_button]]#if list in it,it means from left to right
main_window.from_top_see=[f"Currect Project: {project_name}",f"Path: {project_path}"]
#Control selected files window
if isuseable(control_file_window):
    ##ui
    from_top_see=[f"Project: {project_name}",f"Path: {project_path}",input_box[0]]
    from_buttom_see=[[apply_button,cancel_button]]
    ##logic
    if click(apply_button):
        print("save the change in input_box[0] to data.json")
        control_file_window.close()
    if click(cancel_button):
        print("cancel, not save any change")
    if click(control_selected_file_button):
        control_file_window.close()

#enter_window
if isuseable(enter_window):
    ##ui
    from_top_see=[f"Project: {project_name}",f"Path: {project_path}",[source_button,coped_button],[rs for rs in toggle_switch[0:3]],input_box[1],[generate_chat_txt_button,Open_vs_code_button,toggle_switch[3]],output_box[0]]
    if click(source_button):
        project_choose_window.open()#code will know what is source project
    if click(coped_button):
        project_choose_window.open()#code will know what is coped project
    if click(toggle_switch):
        print("save to data.json")
    if click(generate_chat_txt_button):
        print("generate chat.txt with all our setting in the enter_window")
    if click(Open_vs_code_button):
        project_choose_window.open()#code will know what project to open
        print("open vs code ,must cheak toggle_switch[4]")

if isuseable(project_choose_window):
    """
    new logic:one project we set in projectIO.py, can have many coped project. we call the not coped project as origin project. coped project save at the coder.a origin project cant invite projects of b origin project.
    """
    ##ui
    from_top_see=[f"origin Project: {project_name}",f"Path: {project_path}",input_box[2]]
    from_buttom_see=[[apply_button,cancel_button]]
    ##logic
    if click(apply_button):
        print("save the change in input_box[2] to data.json")
        project_choose_window.close()
    if click(cancel_button):
        print("cancel, not save any change")
    if click(project_choose_window):
        project_choose_window.close()
if isuseable(vs_code):
    print("the extension is in ai-code-helper of this coder project")#extension that we made could be not work well.
