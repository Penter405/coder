"""
input_box 輸入框
output_box 輸出框
button 按鈕
window 窗口
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
coped_project_choose_window=window("choose coped project to enter",[700,500])
save_from_coped_to_origin_project_window=window("save from coped to origin project",[700,500])

#initialize

#in main_window
control_selected_file_button=button("control selected files")
enter_button=button("enter")
exit_button=button("exit")

#in control_file_window
input_box.append("可以勾選的選單，資料夾可以展開")
apply_button=button("apply")#apply the change in input_box[0]
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
    from_top_see=[f"Project: {project_name}",f"Path: {project_path}",[]]
